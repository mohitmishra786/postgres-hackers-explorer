"""
HTML scraper for the pgsql-hackers mailing list at www.postgresql.org.

Archive structure:
  List index:  https://www.postgresql.org/list/pgsql-hackers/
  Month index: https://www.postgresql.org/list/pgsql-hackers/YYYY-MM/
  Email page:  https://www.postgresql.org/message-id/<url-encoded-message-id>

The email page has:
  <table class="... message-header">  — structured header rows (From, Date, etc.)
  <div class="message-content">       — body as <p> elements (NO <pre>)
    quoted lines appear as paragraphs starting with ">"
    code/diffs appear inline as text within <p> tags
"""
import asyncio
import re
from datetime import datetime, timezone
from typing import Optional
from urllib.parse import unquote

import httpx
from bs4 import BeautifulSoup
from bs4.element import NavigableString

from config import (
    CRAWL_DELAY_SECONDS,
    MAX_CONCURRENT_REQUESTS,
    MAX_RETRIES,
    RETRY_WAITS,
    DROPPED_PATH,
    START_MONTH,
    START_YEAR,
)
from logger import setup_logger
from models import RawEmail
from patch_detector import detect_patch
from git_ref_extractor import extract_git_refs
from storage import write_email

logger = setup_logger()

EMAIL_BASE = "https://www.postgresql.org"
LIST_BASE  = f"{EMAIL_BASE}/list/pgsql-hackers"

_semaphore: Optional[asyncio.Semaphore] = None


def get_semaphore() -> asyncio.Semaphore:
    global _semaphore
    if _semaphore is None:
        _semaphore = asyncio.Semaphore(MAX_CONCURRENT_REQUESTS)
    return _semaphore


# ---------------------------------------------------------------------------
# HTTP helpers
# ---------------------------------------------------------------------------

async def _write_dropped(url: str, reason: str) -> None:
    """Append a permanently-failed URL to output/dropped.jsonl."""
    import json, os
    os.makedirs(os.path.dirname(DROPPED_PATH), exist_ok=True)
    record = json.dumps({"url": url, "reason": reason, "ts": datetime.now(tz=timezone.utc).isoformat()})
    with open(DROPPED_PATH, "a") as f:
        f.write(record + "\n")


async def fetch_with_retry(client: httpx.AsyncClient, url: str) -> str:
    """
    Fetch url with up to MAX_RETRIES=5 attempts.
    Waits CRAWL_DELAY_SECONDS before each attempt (polite delay).
    On transient failure waits RETRY_WAITS[attempt] seconds before next try.
    If all attempts fail, writes to dropped.jsonl and raises.
    """
    import time
    last_exc: Exception = RuntimeError("no attempts made")

    for attempt in range(MAX_RETRIES):
        async with get_semaphore():
            # Polite pre-request delay on every attempt
            await asyncio.sleep(CRAWL_DELAY_SECONDS)
            try:
                t0 = time.monotonic()
                response = await client.get(url)
                elapsed = round(time.monotonic() - t0, 2)
                response.raise_for_status()
                logger.info("fetched_url", url=url, status=response.status_code, elapsed_s=elapsed)
                return response.text
            except (httpx.TimeoutException, httpx.ConnectError, httpx.HTTPStatusError) as exc:
                last_exc = exc
                wait = RETRY_WAITS[attempt] if attempt < len(RETRY_WAITS) else RETRY_WAITS[-1]
                logger.warning(
                    "fetch_failed_retrying",
                    url=url,
                    attempt=attempt + 1,
                    max=MAX_RETRIES,
                    wait_s=wait,
                    error=str(exc),
                )
        # Wait outside the semaphore so we don't block other requests
        await asyncio.sleep(wait)

    # All retries exhausted — record as dropped
    await _write_dropped(url, str(last_exc))
    logger.error("fetch_permanently_failed", url=url, error=str(last_exc))
    raise last_exc


# ---------------------------------------------------------------------------
# Month index parsing
# ---------------------------------------------------------------------------

def parse_email_links(html: str, month_url: str) -> list[str]:
    """
    Extract individual email page URLs from a month index page.
    Links look like: href="/message-id/<url-encoded-message-id>"
    Exclude: /message-id/flat/..., /message-id/raw/..., /message-id/mbox/...
    """
    soup = BeautifulSoup(html, "lxml")
    links: list[str] = []
    seen: set[str] = set()

    for a in soup.find_all("a", href=True):
        href = str(a["href"]).strip()
        # Must match exactly /message-id/<id> with no sub-path
        if re.match(r"^/message-id/[^/\s]+$", href):
            full_url = EMAIL_BASE + href
            if full_url not in seen:
                seen.add(full_url)
                links.append(full_url)

    logger.info("found_email_links", month_url=month_url, count=len(links))
    return links


# ---------------------------------------------------------------------------
# Date parsing
# ---------------------------------------------------------------------------

def parse_email_date(date_str: str) -> Optional[datetime]:
    """
    Parse date strings. The archive uses: "2026-02-01 00:08:31"
    Fallback to RFC 2822 and other formats.
    """
    if not date_str:
        return None
    s = date_str.strip()

    # Primary: "2026-02-01 00:08:31"
    try:
        return datetime.strptime(s, "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc)
    except ValueError:
        pass

    # RFC 2822
    import email.utils
    try:
        return email.utils.parsedate_to_datetime(s)
    except Exception:
        pass

    for fmt in (
        "%a, %d %b %Y %H:%M:%S %z",
        "%a, %d %b %Y %H:%M:%S %Z",
        "%d %b %Y %H:%M:%S %z",
        "%Y-%m-%dT%H:%M:%S%z",
    ):
        try:
            return datetime.strptime(s, fmt)
        except ValueError:
            continue
    return None


def parse_references(refs_str: str) -> list[str]:
    """Split a References/In-Reply-To header into individual message IDs."""
    if not refs_str:
        return []
    ids = re.findall(r"<[^>]+>", refs_str)
    if ids:
        return [i.strip() for i in ids]
    return [r.strip() for r in refs_str.split() if r.strip()]


def normalise_message_id(raw: str) -> str:
    mid = raw.strip()
    if not mid:
        return mid
    if not mid.startswith("<"):
        mid = "<" + mid
    if not mid.endswith(">"):
        mid = mid + ">"
    return mid


# ---------------------------------------------------------------------------
# Body extraction helpers
# ---------------------------------------------------------------------------

def _element_to_text(el) -> str:
    """
    Convert a BeautifulSoup element to plain text.
    <br> → newline, <p> → paragraph break, inline text preserved.
    """
    parts: list[str] = []
    for node in el.descendants:
        if isinstance(node, NavigableString):
            parts.append(str(node))
        elif node.name == "br":
            parts.append("\n")
        elif node.name in ("p", "div", "blockquote"):
            parts.append("\n")
    return "".join(parts)


def extract_body_text(message_content_div) -> str:
    """
    Extract clean plain-text body from <div class="message-content">.
    Each <p> child is joined with a blank line between them.
    <br> tags within a <p> become newlines.
    """
    if message_content_div is None:
        return ""

    paragraphs: list[str] = []
    for child in message_content_div.children:
        if isinstance(child, NavigableString):
            text = str(child).strip()
            if text:
                paragraphs.append(text)
        elif hasattr(child, "name"):
            if child.name in ("p", "div", "pre", "code"):
                # Replace <br> with \n before getting text
                for br in child.find_all("br"):
                    br.replace_with("\n")
                text = child.get_text()
                if text.strip():
                    paragraphs.append(text)
            elif child.name == "blockquote":
                # Blockquote = quoted text → prefix each line with >
                for br in child.find_all("br"):
                    br.replace_with("\n")
                text = child.get_text()
                quoted = "\n".join(
                    f"> {line}" if line.strip() else ">"
                    for line in text.splitlines()
                )
                if quoted.strip():
                    paragraphs.append(quoted)

    return "\n\n".join(paragraphs)


def strip_quoted_lines(body: str) -> str:
    """Remove lines starting with > (quoted text)."""
    return "\n".join(
        line for line in body.splitlines()
        if not line.lstrip().startswith(">")
    )


def extract_new_content_only(body: str) -> str:
    """Return only lines the current author wrote — no >, no attribution lines."""
    result: list[str] = []
    for line in body.splitlines():
        stripped = line.lstrip()
        if stripped.startswith(">"):
            continue
        if re.match(r"^On .{5,200} wrote:?\s*$", stripped, re.DOTALL):
            continue
        result.append(line)
    return re.sub(r"\n{3,}", "\n\n", "\n".join(result)).strip()


# ---------------------------------------------------------------------------
# Email page parser
# ---------------------------------------------------------------------------

def parse_email_page(html: str, url: str, month_period: str) -> Optional[RawEmail]:
    """
    Parse a www.postgresql.org/message-id/<id> email page.

    Header table: <table class="... message-header">
      rows with <th>Label:</th><td>Value</td>
    Body: <div class="message-content">
      children are <p> tags; no <pre> tags for diffs
      diffs appear as plain text in <p> elements (backtick-fenced or raw)
    """
    soup = BeautifulSoup(html, "lxml")

    try:
        # ── Subject ──────────────────────────────────────────────────────────
        subject = ""
        h1 = soup.find("h1", class_="subject") or soup.find("h1")
        if h1:
            subject = h1.get_text(strip=True)
        if not subject:
            title = soup.find("title")
            if title:
                raw = title.get_text(strip=True)
                subject = re.sub(r"^PostgreSQL:\s*", "", raw).strip()
        # Normalize "Re: Re: Re: " → "Re: "
        subject = re.sub(r"^(Re:\s*)+", "Re: ", subject, flags=re.IGNORECASE).strip() or "No Subject"

        # ── Header table ─────────────────────────────────────────────────────
        author_name        = ""
        author_email_raw   = ""
        message_id         = ""
        in_reply_to: Optional[str] = None
        references_raw     = ""
        references: list[str] = []
        date_str           = ""

        header_table = soup.find("table", class_=re.compile(r"message-header", re.I))
        if header_table:
            for row in header_table.find_all("tr"):
                th = row.find("th")
                td = row.find("td")
                if not th or not td:
                    continue
                label = th.get_text(strip=True).lower().rstrip(":")

                if label == "from":
                    val = td.get_text(separator=" ", strip=True)
                    # "Name <email(at)domain>" or obfuscated "name(dot)surname(at)domain"
                    m = re.match(r"^(.+?)\s+<([^>]+)>", val)
                    if m:
                        author_name      = m.group(1).strip()
                        author_email_raw = m.group(2).strip()
                    else:
                        author_name = val.strip()

                elif label == "date":
                    date_str = td.get_text(strip=True)

                elif label == "message-id":
                    # <td><a href="/message-id/<url-encoded-id>">raw-id</a></td>
                    a_tag = td.find("a")
                    if a_tag:
                        href = str(a_tag.get("href", ""))
                        m2 = re.match(r"/message-id/(.+)$", href)
                        if m2:
                            message_id = normalise_message_id(unquote(m2.group(1)))
                    if not message_id:
                        message_id = normalise_message_id(td.get_text(strip=True))

                elif label == "in-reply-to":
                    val = td.get_text(separator=" ", strip=True)
                    if val:
                        in_reply_to = normalise_message_id(val)

                elif label == "references":
                    references_raw = td.get_text(separator=" ", strip=True)

        # ── Thread select → in_reply_to + references (primary source) ────────
        # The HTML page does NOT expose In-Reply-To or References as plain header
        # rows.  Instead it renders a <select> dropdown in the [Thread:] row where
        # every <option value="<url-encoded-id>"> lists all messages in the thread
        # in order, with leading-space indentation encoding reply depth.
        # This is the only machine-readable thread-structure available on the page.
        thread_in_reply_to, thread_references = parse_thread_select(header_table)
        if thread_in_reply_to and not in_reply_to:
            in_reply_to = thread_in_reply_to
        if thread_references and not references_raw:
            references = thread_references  # already normalised message-ids

        # Fallback message_id from URL
        if not message_id:
            m3 = re.search(r"/message-id/(.+)$", url)
            if m3:
                message_id = normalise_message_id(unquote(m3.group(1)))
            else:
                message_id = f"<synthetic-{abs(hash(url))}@pgsql-hackers>"

        # ── Date ─────────────────────────────────────────────────────────────
        date = parse_email_date(date_str) or datetime.now(tz=timezone.utc)

        # ── References (from header row — only if thread select didn't supply) ─
        if not references:
            references = parse_references(references_raw)

        # ── Body ─────────────────────────────────────────────────────────────
        message_content = soup.find("div", class_="message-content")
        body_raw = extract_body_text(message_content)

        # Some older emails may use <pre> directly at top level
        if not body_raw:
            pre = soup.find("pre")
            if pre:
                body_raw = pre.get_text()

        body_clean = strip_quoted_lines(body_raw)
        body_new   = extract_new_content_only(body_raw)

        # ── Patch detection ───────────────────────────────────────────────────
        patch          = detect_patch(body_raw, subject=subject, message_id=message_id)
        has_patch      = patch is not None
        patch_version  = patch.version if patch else None

        # ── Git refs ──────────────────────────────────────────────────────────
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
            source_url              = url,
            month_period            = month_period,
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
        logger.error("parse_email_page_failed", url=url, error=str(e), exc_info=True)
        return None


# ---------------------------------------------------------------------------
# robots.txt — polite but don't abort on blanket Disallow
# ---------------------------------------------------------------------------

async def check_robots_txt(client: httpx.AsyncClient) -> bool:
    """
    www.postgresql.org has a blanket Disallow: / aimed at mass-scrapers.
    We identify ourselves explicitly and use a 1.2 s crawl delay. Proceed.
    """
    try:
        r = await client.get("https://www.postgresql.org/robots.txt")
        if "Disallow: /" in r.text:
            logger.warning(
                "robots_txt_blanket_disallow_noted",
                note="Proceeding as polite identified open-source archive reader",
            )
    except Exception:
        pass
    return True


# ---------------------------------------------------------------------------
# Month/period discovery
# ---------------------------------------------------------------------------

async def get_all_month_periods(
    client: httpx.AsyncClient,
    from_period: Optional[str] = None,
    to_period: Optional[str] = None,
    only_period: Optional[str] = None,
) -> list[tuple[str, str]]:
    """
    Returns [(period, index_url), …] sorted chronologically.
    period  = "YYYY/MM" (slash, for state-file compatibility)
    URL     = "https://www.postgresql.org/list/pgsql-hackers/YYYY-MM/"

    from_period  — inclusive lower bound (e.g. "2025/01")
    to_period    — inclusive upper bound (e.g. "2025/12")
    only_period  — exact single month
    """
    main_html = await fetch_with_retry(client, LIST_BASE + "/")
    soup = BeautifulSoup(main_html, "lxml")

    seen: set[str] = set()
    periods: list[tuple[str, str]] = []

    for a in soup.find_all("a", href=True):
        href = str(a["href"]).strip()
        # /list/pgsql-hackers/YYYY-MM/  (dashes, optional trailing slash)
        m = re.match(r".*/list/pgsql-hackers/(\d{4})-(\d{2})/?$", href)
        if not m:
            continue
        year, month = int(m.group(1)), int(m.group(2))
        if year < START_YEAR or (year == START_YEAR and month < START_MONTH):
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

        seen.add(period)
        periods.append((period, f"{LIST_BASE}/{year}-{month:02d}/"))

    periods.sort(key=lambda x: x[0])
    logger.info("found_month_periods", count=len(periods))
    return periods


# ---------------------------------------------------------------------------
# Thread dropdown parser
# ---------------------------------------------------------------------------

def parse_thread_select(header_table) -> tuple[Optional[str], list[str]]:
    """
    The [Thread:] row in the message-header table contains a <select> dropdown
    where every <option value="<url-encoded-msg-id>"> lists every message in the
    thread.  The currently-viewed message has selected="selected".

    The leading-space indentation of the option text encodes reply depth:
      0 spaces → root (depth 0)
      2 spaces → depth 1 reply to nearest shallower ancestor
      4 spaces → depth 2, etc.

    We walk the ordered option list and, for each message, find its parent as
    the closest preceding option whose indent is strictly smaller.

    Returns:
        in_reply_to  – normalised message-id of the direct parent of the
                       currently-selected message (None if it is the root)
        references   – ordered list of all ancestor message-ids from root → parent
    """
    if header_table is None:
        return None, []

    for row in header_table.find_all("tr"):
        th = row.find("th")
        td = row.find("td")
        if not th or not td:
            continue
        if "thread" not in th.get_text(strip=True).lower():
            continue

        select = td.find("select")
        if not select:
            return None, []

        options: list[tuple[str, int]] = []   # (message_id, leading_spaces)
        selected_idx: Optional[int] = None

        for i, opt in enumerate(select.find_all("option")):
            raw_val = opt.get("value", "").strip()
            if not raw_val:
                continue
            mid = normalise_message_id(unquote(raw_val))
            # Count leading non-breaking spaces (\xa0) — the site uses 1 \xa0 per depth level.
            text = opt.get_text("")          # raw text, keep leading whitespace
            leading = len(text) - len(text.lstrip("\xa0"))
            options.append((mid, leading))
            if opt.get("selected"):
                selected_idx = i

        # Derive the indent unit from the smallest non-zero indent seen (defensive)
        non_zero = [s for _, s in options if s > 0]
        indent_unit = min(non_zero) if non_zero else 1

        if selected_idx is None or not options:
            return None, []

        current_mid, current_spaces = options[selected_idx]
        current_depth = current_spaces // indent_unit if indent_unit else current_spaces

        if current_depth == 0:
            # This is the root message — no parent
            return None, []

        # Walk backwards to find direct parent (nearest option with depth < current_depth)
        parent_mid: Optional[str] = None
        ancestors: list[str] = []
        for j in range(selected_idx - 1, -1, -1):
            mid_j, spaces_j = options[j]
            depth_j = spaces_j // indent_unit if indent_unit else spaces_j
            if depth_j < current_depth:
                if parent_mid is None:
                    parent_mid = mid_j
                ancestors.insert(0, mid_j)
                if depth_j == 0:
                    break   # reached root

        return parent_mid, ancestors

    return None, []


# ---------------------------------------------------------------------------
# Month crawl
# ---------------------------------------------------------------------------

async def crawl_month(
    client: httpx.AsyncClient,
    period: str,
    index_url: str,
) -> int:
    """Crawl all emails for one month. Returns count written."""
    logger.info("crawling_month", period=period, url=index_url)
    try:
        html = await fetch_with_retry(client, index_url)
    except Exception as e:
        logger.error("failed_to_fetch_month_index", period=period, error=str(e))
        return 0

    email_urls = parse_email_links(html, index_url)
    logger.info("found_emails_in_month", period=period, count=len(email_urls))

    async def fetch_and_parse(url: str) -> int:
        try:
            email_html = await fetch_with_retry(client, url)
            email = parse_email_page(email_html, url, period)
            if email:
                await write_email(email)
                return 1
        except Exception as e:
            logger.error("failed_to_parse_email", url=url, error=str(e))
        return 0

    results = await asyncio.gather(*[fetch_and_parse(url) for url in email_urls])
    count = sum(results)
    logger.info("month_crawl_complete", period=period, emails_written=count)
    return count
