"""
Retry all URLs listed in output/dropped.jsonl.

- Month index URLs  (/list/pgsql-hackers/YYYY-MM/)  → re-crawl that whole month
- Individual email URLs  (/message-id/...)           → fetch + parse + append to emails.jsonl

Successfully fetched URLs are removed from dropped.jsonl.
Still-failing URLs stay in dropped.jsonl for the next retry.
Appends new emails to the existing emails.jsonl — does NOT touch anything already there.
"""
import asyncio
import json
import os
import re
import sys

import httpx

from config import CRAWL_DELAY_SECONDS, DROPPED_PATH, MAX_RETRIES, RETRY_WAITS
from logger import setup_logger
from scraper import (
    fetch_with_retry,
    parse_email_links,
    parse_email_page,
)
from storage import write_email
from thread_reconstructor import reconstruct_threads
from storage import read_all_emails, write_all_emails

logger = setup_logger()

EMAIL_BASE = "https://www.postgresql.org"


def load_dropped() -> list[dict]:
    if not os.path.exists(DROPPED_PATH):
        return []
    with open(DROPPED_PATH) as f:
        return [json.loads(l) for l in f if l.strip()]


def save_dropped(records: list[dict]) -> None:
    with open(DROPPED_PATH, "w") as f:
        for r in records:
            f.write(json.dumps(r) + "\n")


def period_from_index_url(url: str) -> str:
    """Extract YYYY/MM from a month-index URL."""
    m = re.search(r"/pgsql-hackers/(\d{4})-(\d{2})/?$", url)
    if m:
        return f"{m.group(1)}/{m.group(2)}"
    return "unknown"


async def retry_all() -> None:
    dropped = load_dropped()
    if not dropped:
        print("Nothing in dropped.jsonl — nothing to do.")
        return

    print(f"Found {len(dropped)} dropped URL(s) to retry.")

    still_failed: list[dict] = []
    recovered = 0

    async with httpx.AsyncClient(
        headers={"User-Agent": "pghackers-explorer/1.0"},
        follow_redirects=True,
        timeout=30,
    ) as client:

        for record in dropped:
            url = record["url"]

            # ── Month index URL ──────────────────────────────────────────────
            if re.search(r"/list/pgsql-hackers/\d{4}-\d{2}/?$", url):
                period = period_from_index_url(url)
                print(f"\n[month index] {url}  (period={period})")
                try:
                    html = await fetch_with_retry(client, url)
                    email_urls = parse_email_links(html, url)
                    print(f"  → found {len(email_urls)} emails, fetching each...")
                    month_ok = 0
                    for eurl in email_urls:
                        try:
                            ehtml = await fetch_with_retry(client, eurl)
                            email = parse_email_page(ehtml, eurl, period)
                            if email:
                                await write_email(email)
                                month_ok += 1
                        except Exception as e:
                            logger.warning("retry_email_failed", url=eurl, error=str(e))
                            still_failed.append({"url": eurl, "reason": str(e), "ts": record["ts"]})
                    print(f"  → recovered {month_ok}/{len(email_urls)} emails from month index")
                    recovered += 1
                except Exception as e:
                    print(f"  ✗ still failing: {e}")
                    still_failed.append({**record, "reason": str(e)})

            # ── Individual email URL ─────────────────────────────────────────
            elif re.search(r"/message-id/", url):
                # Guess period from dropped timestamp (good enough for month_period field)
                ts = record.get("ts", "")
                period = ts[:7].replace("-", "/") if ts else "unknown"
                print(f"\n[email] {url}")
                try:
                    html = await fetch_with_retry(client, url)
                    email = parse_email_page(html, url, period)
                    if email:
                        await write_email(email)
                        print(f"  → recovered: {email.subject[:80]}")
                        recovered += 1
                    else:
                        print(f"  ✗ parsed but returned None")
                        still_failed.append({**record, "reason": "parse returned None"})
                except Exception as e:
                    print(f"  ✗ still failing: {e}")
                    still_failed.append({**record, "reason": str(e)})

            else:
                print(f"\n[unknown url type] {url} — skipping")
                still_failed.append(record)

    # Re-run thread reconstruction over full emails.jsonl
    print(f"\nRe-running thread reconstruction...")
    all_emails = read_all_emails()
    updated = reconstruct_threads(all_emails)
    write_all_emails(updated)

    # Update dropped.jsonl
    save_dropped(still_failed)

    print(f"\n{'='*50}")
    print(f"Recovered : {recovered}")
    print(f"Still failed : {len(still_failed)}")
    if still_failed:
        print("Remaining dropped URLs:")
        for r in still_failed:
            print(f"  {r['url']}")
    else:
        print("dropped.jsonl is now empty — all recovered!")


if __name__ == "__main__":
    asyncio.run(retry_all())
