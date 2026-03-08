"""
MARC.info scraper for pgsql-hackers mailing list.

WHY MARC vs postgresql.org:
  postgresql.org caps at 200 emails per month index page.
  MARC.info has no cap — Jan 2026 has 2,977 messages.

CRITICAL DISCOVERY — how MARC.info paginates:
  The month index page (?l=pgsql-hackers&r=1&b=YYYYMM&w=2) only shows a
  maximum of 20 pages × 30 emails = 600 emails, even for months with 2,977.
  There is NO URL parameter to increase this cap.

CORRECT CRAWL STRATEGY — "prev in list" chaining:
  Every individual email page has [prev in list] and [next in list] navigation
  links. These chain through ALL emails in the list in chronological order,
  regardless of the 600-email index cap.

  To collect all emails for month YYYYMM:
  1. Load the month index (r=1, b=YYYYMM) → get the FIRST email ID shown
     (this is the newest email in that month).
  2. Start from that ID and walk "prev in list" repeatedly.
  3. At each step: check whether the email's page contains a link back to
     b=YYYYMM. If yes → it belongs to this month, collect it.
     If no → we've crossed into the previous month, stop.
  4. The walk visits every single one of the 2,977 Jan 2026 emails.

Rate limiting (MARC.info robot policy):
  - MARC.info explicitly asks for "one or two seconds" between requests.
  - robots.txt: Disallow:/ for * but they throttle by behaviour, not hard block.
  - We start at CRAWL_DELAY_SECONDS (0.8s) — respectful but fast.
  - Adaptive backoff: on 429/503/connect error delay steps up through
    BACKOFF_STEPS [0.8, 1.2, 1.5, 2.0, 3.0]. After BACKOFF_RECOVERY_AFTER
    consecutive clean successes it resets to 0.8s.
  - MAX_CONCURRENT_REQUESTS = 5 (semaphore-controlled).

Each email = 2 HTTP requests (HTML page + raw body).
Estimated time for Jan 2026 (2,977 emails × 2 req, 5 concurrent, 0.8s delay):
  ~2,977 × 2 / 5 × 0.8s ≈ ~16 min + overhead ≈ 25-35 min total.
"""
import asyncio
import re
import time
from datetime import datetime, timezone
from typing import Optional
from urllib.parse import unquote

import httpx
from bs4 import BeautifulSoup

from config import (
    BACKOFF_RECOVERY_AFTER,
    BACKOFF_STEPS,
    CRAWL_DELAY_SECONDS,
    MAX_CONCURRENT_REQUESTS,
    MAX_RETRIES,
    RETRY_WAITS,
    DROPPED_PATH,
)
from logger import setup_logger
from models import RawEmail
from patch_detector import detect_patch
from git_ref_extractor import extract_git_refs
from storage import write_email

logger = setup_logger()

MARC_BASE = "https://marc.info"
LIST_NAME = "pgsql-hackers"

MARC_START_YEAR = 1997
MARC_START_MONTH = 6

_semaphore: Optional[asyncio.Semaphore] = None

# ---------------------------------------------------------------------------
# Adaptive delay state
# ---------------------------------------------------------------------------
_current_delay: float = CRAWL_DELAY_SECONDS
_consecutive_successes: int = 0
_backoff_step_idx: int = 0
_adaptive_lock: Optional[asyncio.Lock] = None


def get_semaphore() -> asyncio.Semaphore:
    global _semaphore
    if _semaphore is None:
        _semaphore = asyncio.Semaphore(MAX_CONCURRENT_REQUESTS)
    return _semaphore


def get_adaptive_lock() -> asyncio.Lock:
    global _adaptive_lock
    if _adaptive_lock is None:
        _adaptive_lock = asyncio.Lock()
    return _adaptive_lock


async def _record_success() -> None:
    global _current_delay, _consecutive_successes, _backoff_step_idx
    async with get_adaptive_lock():
        _consecutive_successes += 1
        if _consecutive_successes >= BACKOFF_RECOVERY_AFTER and _backoff_step_idx > 0:
            _backoff_step_idx = max(0, _backoff_step_idx - 1)
            _current_delay = BACKOFF_STEPS[_backoff_step_idx]
            _consecutive_successes = 0
            logger.info("adaptive_delay_decreased", new_delay=_current_delay)


async def _record_throttle() -> None:
    global _current_delay, _consecutive_successes, _backoff_step_idx
    async with get_adaptive_lock():
        _consecutive_successes = 0
        _backoff_step_idx = min(_backoff_step_idx + 1, len(BACKOFF_STEPS) - 1)
        _current_delay = BACKOFF_STEPS[_backoff_step_idx]
        logger.warning("adaptive_delay_increased", new_delay=_current_delay)


# ---------------------------------------------------------------------------
# HTTP helpers
# ---------------------------------------------------------------------------

async def _write_dropped(url: str, reason: str) -> None:
    import json, os
    os.makedirs(os.path.dirname(DROPPED_PATH), exist_ok=True)
    record = json.dumps({
        "url": url, "reason": reason,
        "ts": datetime.now(tz=timezone.utc).isoformat(),
    })
    with open(DROPPED_PATH, "a") as f:
        f.write(record + "\n")


def _is_throttle_signal(exc: Exception) -> bool:
    if isinstance(exc, httpx.HTTPStatusError):
        return exc.response.status_code in (429, 503, 502, 504)
    if isinstance(exc, (httpx.TimeoutException, httpx.ConnectError,
                        httpx.RemoteProtocolError)):
        return True
    return False


async def fetch_with_retry(client: httpx.AsyncClient, url: str) -> str:
    """
    Fetch url with adaptive polite delay + exponential retry.
    Classifies 429/503/timeout as throttle signals → steps delay up.
    """
    last_exc: Exception = RuntimeError("no attempts made")

    for attempt in range(MAX_RETRIES):
        async with get_semaphore():
            delay = _current_delay
            await asyncio.sleep(delay)
            try:
                t0 = time.monotonic()
                response = await client.get(url)
                elapsed = round(time.monotonic() - t0, 2)
                response.raise_for_status()
                await _record_success()
                logger.info(
                    "fetched_url",
                    url=url, status=response.status_code,
                    elapsed_s=elapsed, delay_used=delay,
                )
                return response.text
            except Exception as exc:
                last_exc = exc
                if _is_throttle_signal(exc):
                    await _record_throttle()
                wait = RETRY_WAITS[attempt] if attempt < len(RETRY_WAITS) else RETRY_WAITS[-1]
                logger.warning(
                    "fetch_failed_retrying",
                    url=url, attempt=attempt + 1, max=MAX_RETRIES,
                    wait_s=wait, current_delay=_current_delay, error=str(exc),
                )
        await asyncio.sleep(wait)

    await _write_dropped(url, str(last_exc))
    logger.error("fetch_permanently_failed", url=url, error=str(last_exc))
    raise last_exc


# ---------------------------------------------------------------------------
# Month discovery
# ---------------------------------------------------------------------------

async def get_all_marc_month_periods(
    client: httpx.AsyncClient,
    from_period: Optional[str] = None,
    to_period: Optional[str] = None,
    only_period: Optional[str] = None,
) -> list[tuple[str, int, int]]:
    """
    Scrape the MARC.info main list index to discover all available months.
    Returns list of (period_str "YYYY/MM", year, month) sorted chronologically.
    Also returns the total message count from the index for logging.
    """
    url = f"{MARC_BASE}/?l={LIST_NAME}&r=1&w=2"
    html = await fetch_with_retry(client, url)
    soup = BeautifulSoup(html, "lxml")

    seen: set[str] = set()
    periods: list[tuple[str, int, int]] = []

    for a in soup.find_all("a", href=True):
        href = str(a["href"]).strip()
        m = re.match(r"\?l=pgsql-hackers&r=1&b=(\d{4})(\d{2})&w=\d", href)
        if not m:
            continue
        year, month = int(m.group(1)), int(m.group(2))
        if year < MARC_START_YEAR or (year == MARC_START_YEAR and month < MARC_START_MONTH):
            continue

        period = f"{year}/{month:02d}"
        if only_period and period != only_period:
            continue
        if from_period and period < from_period:
            continue
        if to_period and period > to_period:
            continue
        if period in seen:
            continue

        # Extract message count from the link text e.g. "(2977 messages)"
        text = a.get_text()
        count_m = re.search(r"\((\d+)\s+messages?\)", text)
        msg_count = int(count_m.group(1)) if count_m else "?"

        seen.add(period)
        periods.append((period, year, month))
        logger.info("discovered_month", period=period, messages=msg_count)

    periods.sort(key=lambda x: x[0])
    logger.info("found_marc_month_periods", count=len(periods))
    return periods


# ---------------------------------------------------------------------------
# Core: collect ALL marc_ids for a month via "prev in list" chaining
# ---------------------------------------------------------------------------

def _get_all_ids_from_index(html: str) -> list[str]:
    """Get all email IDs listed on a month index page, in page order (newest first)."""
    return re.findall(r'\?l=pgsql-hackers&m=(\d+)&w=2"', html)


def _get_prev_in_list(html: str) -> Optional[str]:
    """Extract the 'prev in list' marc_id from an individual email page."""
    m = re.search(
        r'\[<a href="\?l=pgsql-hackers&m=(\d+)&w=2">prev in list</a>\]',
        html
    )
    return m.group(1) if m else None


def _email_belongs_to_month(html: str, year: int, month: int) -> bool:
    """
    Check whether this email's HTML page contains a link back to b=YYYYMM,
    confirming it belongs to the requested month's bucket in MARC.info.
    """
    bucket = f"b={year}{month:02d}"
    return bucket in html


async def collect_all_month_marc_ids(
    client: httpx.AsyncClient,
    year: int,
    month: int,
) -> list[str]:
    """
    Collect ALL marc_ids for a given month using "prev in list" chaining.

    Algorithm:
    1. Load month index page (r=1) — get candidate IDs.
    2. Find the first candidate whose page has an *active* prev-in-list link.
       Some index entries are cross-list posts with greyed-out navigation; skip them.
    3. Walk prev-in-list from that ID, collecting every ID whose page
       contains the b=YYYYMM bucket link.
    4. Stop when b=YYYYMM disappears from 3+ consecutive pages (crossed into prev month).

    This correctly retrieves ALL emails e.g. all 2,977 for Jan 2026,
    not just the 600 shown on the index pages.
    """
    index_url = f"{MARC_BASE}/?l={LIST_NAME}&r=1&b={year}{month:02d}&w=2"

    try:
        index_html = await fetch_with_retry(client, index_url)
    except Exception as e:
        logger.error("failed_to_fetch_month_index", year=year, month=month, error=str(e))
        return []

    candidate_ids = _get_all_ids_from_index(index_html)
    if not candidate_ids:
        logger.warning("no_ids_on_index_page", year=year, month=month)
        return []

    # Find the first candidate with an active prev-in-list link.
    # Cross-list posts show greyed-out nav (<font> tag, no <a> link).
    first_id: Optional[str] = None
    collected_before_walk: list[str] = []   # IDs we visited during the probe scan

    for cid in candidate_ids:
        url = f"{MARC_BASE}/?l={LIST_NAME}&m={cid}&w=2"
        try:
            html = await fetch_with_retry(client, url)
        except Exception as e:
            logger.warning("probe_fetch_failed", marc_id=cid, error=str(e))
            continue

        if _email_belongs_to_month(html, year, month):
            collected_before_walk.append(cid)

        prev = _get_prev_in_list(html)
        if prev:
            first_id = prev   # start walk from *this* prev (we already have cid)
            logger.info(
                "starting_prev_walk",
                year=year, month=month,
                probe_id=cid, first_id=first_id,
                probed=len(collected_before_walk),
            )
            break
        # else: greyed-out nav — this email has no list neighbours; try next candidate

    if not first_id:
        # No candidate had active prev-in-list; fall back to whatever we probed
        logger.warning(
            "no_active_prev_link_found",
            year=year, month=month,
            returning=len(collected_before_walk),
        )
        return collected_before_walk

    all_ids: list[str] = list(collected_before_walk)  # include probed IDs
    current_id = first_id
    visited: set[str] = set(collected_before_walk)
    consecutive_out_of_month = 0  # safety: stop if 3+ consecutive are out-of-month

    while current_id and current_id not in visited:
        visited.add(current_id)
        url = f"{MARC_BASE}/?l={LIST_NAME}&m={current_id}&w=2"

        try:
            html = await fetch_with_retry(client, url)
        except Exception as e:
            logger.error("failed_to_fetch_email_page", marc_id=current_id, error=str(e))
            # Try to continue — get next ID from last known page if possible
            break

        belongs = _email_belongs_to_month(html, year, month)

        if belongs:
            all_ids.append(current_id)
            consecutive_out_of_month = 0
            if len(all_ids) % 100 == 0:
                logger.info(
                    "prev_walk_progress",
                    year=year, month=month,
                    collected=len(all_ids), current_id=current_id,
                )
        else:
            consecutive_out_of_month += 1
            logger.debug(
                "email_out_of_month_bucket",
                marc_id=current_id, year=year, month=month,
            )
            # Allow up to 3 consecutive out-of-month (delayed delivery edge cases)
            # before declaring the walk complete
            if consecutive_out_of_month >= 3:
                logger.info(
                    "prev_walk_complete",
                    year=year, month=month, total_collected=len(all_ids),
                    stopped_at=current_id,
                )
                break

        prev_id = _get_prev_in_list(html)
        if not prev_id:
            logger.info(
                "prev_walk_end_of_list",
                year=year, month=month, total_collected=len(all_ids),
            )
            break

        current_id = prev_id

    logger.info(
        "marc_month_ids_collected",
        year=year, month=month, total=len(all_ids),
    )
    return all_ids


# ---------------------------------------------------------------------------
# Parse individual email page + raw body
# ---------------------------------------------------------------------------

def _decode_qp(text: str) -> str:
    import quopri
    try:
        return quopri.decodestring(text.encode()).decode("utf-8", errors="replace")
    except Exception:
        return text


def _strip_quoted_lines(body: str) -> str:
    return "\n".join(
        line for line in body.splitlines()
        if not line.lstrip().startswith(">")
    )


def _extract_new_content_only(body: str) -> str:
    result: list[str] = []
    for line in body.splitlines():
        stripped = line.lstrip()
        if stripped.startswith(">"):
            continue
        if re.match(r"^On .{5,200} wrote:?\s*$", stripped, re.DOTALL):
            continue
        result.append(line)
    return re.sub(r"\n{3,}", "\n\n", "\n".join(result)).strip()


def _normalise_message_id(raw: str) -> str:
    mid = raw.strip()
    if not mid:
        return mid
    # MARC obfuscates @ as " () " and . as " ! "
    mid = re.sub(r"\s*\(\)\s*", "@", mid)
    mid = re.sub(r"\s+!\s+", ".", mid)
    mid = mid.strip()
    if not mid.startswith("<"):
        mid = "<" + mid
    if not mid.endswith(">"):
        mid = mid + ">"
    return mid


def _parse_references(refs_str: str) -> list[str]:
    if not refs_str:
        return []
    ids = re.findall(r"<[^>]+>", refs_str)
    if ids:
        return [i.strip() for i in ids]
    return [r.strip() for r in refs_str.split() if r.strip()]


def _parse_marc_date(date_str: str) -> Optional[datetime]:
    if not date_str:
        return None
    s = date_str.strip()
    try:
        return datetime.strptime(s, "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc)
    except ValueError:
        pass
    try:
        return datetime.strptime(s, "%Y-%m-%d %H:%M:%S %z")
    except ValueError:
        pass
    import email.utils
    try:
        return email.utils.parsedate_to_datetime(s)
    except Exception:
        pass
    for fmt in ("%a, %d %b %Y %H:%M:%S %z", "%d %b %Y %H:%M:%S %z"):
        try:
            return datetime.strptime(s, fmt)
        except ValueError:
            continue
    return None


def _extract_body_from_raw(raw_msg: str) -> str:
    """Extract body from raw RFC 2822 message, decoding QP encoding."""
    if "\r\n\r\n" in raw_msg:
        body = raw_msg.split("\r\n\r\n", 1)[1]
    elif "\n\n" in raw_msg:
        body = raw_msg.split("\n\n", 1)[1]
    else:
        body = raw_msg

    body = body.replace("\r\n", "\n")
    # Decode QP soft line breaks
    body = re.sub(r"=\n", "", body)

    def decode_hex(m: re.Match) -> str:
        try:
            return bytes.fromhex(m.group(1)).decode("utf-8", errors="replace")
        except Exception:
            return m.group(0)

    body = re.sub(r"=([0-9A-Fa-f]{2})", decode_hex, body)
    return body.strip()


def parse_marc_email_page(
    html: str,
    raw_body: str,
    marc_id: str,
    month_period: str,
) -> Optional[RawEmail]:
    """
    Parse a MARC.info email HTML page to extract all headers and body.

    Header block is in the <font size=+1> block:
        List:       pgsql-hackers
        Subject:    Re: foo
        From:       Name <user () domain ! tld>
        Date:       2026-01-31 23:21:54
        Message-ID: <ID () domain ! tld>
    """
    source_url = f"{MARC_BASE}/?l={LIST_NAME}&m={marc_id}&w=2"

    try:
        soup = BeautifulSoup(html, "lxml")

        subject      = ""
        author_name  = ""
        author_email_raw = ""
        message_id   = ""
        in_reply_to: Optional[str] = None
        references_raw = ""
        date_str     = ""
        marc_thread_id: Optional[str] = None

        # Extract MARC thread ID from the Subject link: ?t=THREADID&r=1&w=2
        # This is the only reliable threading signal MARC exposes (no In-Reply-To/References)
        t_match = re.search(r'\?t=(\d+)&r=1&w=2', html)
        if t_match:
            marc_thread_id = t_match.group(1)

        # Primary: parse the <font size=+1> structured header block
        font_block = soup.find("font", attrs={"size": "+1"})
        if font_block:
            block_text = font_block.get_text("\n")
            lines = [l.strip() for l in block_text.splitlines()]
            for idx, line in enumerate(lines):
                def _next_line_val(prefix: str) -> str:
                    """Value after prefix on same line; if empty, take next non-empty line."""
                    val = line[len(prefix):].strip()
                    if not val:
                        for nxt in lines[idx + 1:]:
                            nxt = nxt.strip()
                            if nxt:
                                val = nxt
                                break
                    return val

                if line.startswith("Subject:"):
                    subject = _next_line_val("Subject:")
                elif line.startswith("From:"):
                    from_val = _next_line_val("From:")
                    m = re.match(r"^(.+?)\s+<([^>]+)>", from_val)
                    if m:
                        author_name      = m.group(1).strip()
                        author_email_raw = _normalise_message_id(m.group(2)).strip("<>")
                    else:
                        author_name = from_val.strip()
                elif line.startswith("Date:"):
                    date_str = _next_line_val("Date:")
                elif line.startswith("Message-ID:"):
                    message_id = _normalise_message_id(_next_line_val("Message-ID:"))
                elif line.startswith("In-Reply-To:"):
                    in_reply_to = _normalise_message_id(_next_line_val("In-Reply-To:"))
                elif line.startswith("References:"):
                    references_raw = _next_line_val("References:")

            # Extract message_id from href if not found in text
            if not message_id:
                for a in font_block.find_all("a", href=True):
                    mi = re.search(r"\?i=([^&\"]+)", str(a["href"]))
                    if mi:
                        message_id = _normalise_message_id(unquote(mi.group(1)))
                        break

        # Fallback: parse the <pre> block for headers
        if not subject:
            pre = soup.find("pre")
            if pre:
                pre_text = pre.get_text()
                for line in pre_text.splitlines():
                    if line.startswith("Subject:") and not subject:
                        subject = line[len("Subject:"):].strip()
                    elif line.startswith("From:") and not author_name:
                        from_val = line[len("From:"):].strip()
                        m = re.match(r"^(.+?)\s+<([^>]+)>", from_val)
                        if m:
                            author_name      = m.group(1).strip()
                            author_email_raw = _normalise_message_id(m.group(2)).strip("<>")
                        else:
                            author_name = from_val.strip()
                    elif line.startswith("Date:") and not date_str:
                        date_str = line[len("Date:"):].strip()
                    elif line.startswith("Message-ID:") and not message_id:
                        message_id = _normalise_message_id(line[len("Message-ID:"):].strip())

        # Ultimate fallback message_id
        if not message_id:
            message_id = f"<marc-{marc_id}@{LIST_NAME}>"

        # Normalise subject
        subject = re.sub(r"^(Re:\s*)+", "Re: ", subject, flags=re.IGNORECASE).strip()
        if not subject:
            subject = "No Subject"

        # Parse date
        date = _parse_marc_date(date_str) or datetime.now(tz=timezone.utc)

        # References
        references = _parse_references(references_raw)

        # Body: prefer raw RFC 2822 body (QP decoded)
        body_raw = ""
        if raw_body:
            body_raw = _extract_body_from_raw(raw_body)
            if not body_raw:
                body_raw = raw_body

        # If QP artefacts remain, decode
        if body_raw and ("=\n" in body_raw or re.search(r"=[0-9A-Fa-f]{2}", body_raw)):
            body_raw = _decode_qp(body_raw)

        # Fallback body from HTML <pre>
        if not body_raw:
            pre = soup.find("pre")
            if pre:
                pre_text = pre.get_text()
                # Skip past header lines (blank line separator)
                lines = pre_text.splitlines()
                in_body = False
                body_lines = []
                for line in lines:
                    if in_body:
                        body_lines.append(line)
                    elif line.strip() == "":
                        in_body = True
                body_raw = "\n".join(body_lines).strip()

        body_clean = _strip_quoted_lines(body_raw)
        body_new   = _extract_new_content_only(body_raw)

        # Patch detection
        patch         = detect_patch(body_raw, subject=subject, message_id=message_id)
        has_patch     = patch is not None
        patch_version = patch.version if patch else None

        # Git refs
        git_refs = extract_git_refs(body_raw)

        return RawEmail(
            message_id              = message_id,
            in_reply_to             = in_reply_to,
            references              = references,
            subject                 = subject,
            author_name             = author_name or "Unknown",
            author_email_obfuscated = author_email_raw,
            date                    = date,
            body_raw                = body_raw,
            body_clean              = body_clean,
            body_new_content        = body_new,
            source_url              = source_url,
            month_period            = month_period,
            marc_thread_id          = marc_thread_id,
            has_patch               = has_patch,
            patch_version           = patch_version,
            patch_content           = patch.content if patch else None,
            patch_lines_added       = patch.lines_added if patch else 0,
            patch_lines_removed     = patch.lines_removed if patch else 0,
            patch_files_changed     = patch.files_changed if patch else 0,
            patch_filename          = patch.filename if patch else None,
            git_commit_refs         = git_refs,
        )

    except Exception as e:
        logger.error("parse_marc_email_failed", marc_id=marc_id,
                     error=str(e), exc_info=True)
        return None


# ---------------------------------------------------------------------------
# Month crawl orchestrator
# ---------------------------------------------------------------------------

async def crawl_marc_month(
    client: httpx.AsyncClient,
    period: str,
    year: int,
    month: int,
) -> int:
    """
    Crawl ALL emails for one month from MARC.info.
    Uses prev-in-list chaining to get every email, not just the 600-cap index.
    Returns count of emails successfully written to JSONL.
    """
    logger.info("crawling_marc_month", period=period, year=year, month=month)

    marc_ids = await collect_all_month_marc_ids(client, year, month)
    if not marc_ids:
        logger.warning("no_marc_ids_found", period=period)
        return 0

    logger.info("fetching_marc_emails", period=period, count=len(marc_ids))

    written = 0
    errors  = 0

    async def fetch_one(marc_id: str) -> int:
        raw_url = f"{MARC_BASE}/?l={LIST_NAME}&m={marc_id}&q=raw"
        try:
            # We already fetched the HTML page during ID collection (prev walk),
            # but we don't cache it. Re-fetch HTML + raw body here for full parse.
            # The HTML page contains structured headers; raw gives clean body.
            html_url = f"{MARC_BASE}/?l={LIST_NAME}&m={marc_id}&w=2"
            html = await fetch_with_retry(client, html_url)
            raw  = await fetch_with_retry(client, raw_url)
            email_obj = parse_marc_email_page(html, raw, marc_id, period)
            if email_obj:
                await write_email(email_obj)
                return 1
            else:
                logger.warning("parse_returned_none", marc_id=marc_id)
        except Exception as e:
            logger.error("failed_to_fetch_marc_email", marc_id=marc_id, error=str(e))
        return 0

    # Process in batches of 10 to limit asyncio.gather task count
    BATCH = 10
    total = 0
    for i in range(0, len(marc_ids), BATCH):
        batch_ids = marc_ids[i: i + BATCH]
        results   = await asyncio.gather(*[fetch_one(mid) for mid in batch_ids])
        batch_count = sum(results)
        total += batch_count
        errors += len(batch_ids) - batch_count
        logger.info(
            "marc_batch_complete",
            period=period, batch_start=i,
            batch_fetched=batch_count, total_so_far=total,
        )

    logger.info(
        "marc_month_complete",
        period=period, emails_written=total,
        errors=errors, expected=len(marc_ids),
    )
    return total


# ---------------------------------------------------------------------------
# Public entry-points (called from main.py)
# ---------------------------------------------------------------------------

async def run_marc_scrape_month(
    client: httpx.AsyncClient,
    period: str,
    year: int,
    month: int,
) -> int:
    """Crawl a single month. Used by main.py for per-month checkpointing."""
    return await crawl_marc_month(client, period, year, month)
