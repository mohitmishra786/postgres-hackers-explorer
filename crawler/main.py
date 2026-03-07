"""
pghackers.com — Crawler Entry Point

Usage:
  python main.py scrape                       # crawl all HTML archive pages (postgresql.org, 200/mo cap)
  python main.py scrape --from 2024/01        # crawl from a specific month
  python main.py scrape --only 2026/02        # crawl only one specific month
  python main.py incremental                  # only fetch months newer than last crawl
  python main.py marc-scrape                  # crawl MARC.info — full archive, no 200/mo cap
  python main.py marc-scrape --from 2026/01   # crawl MARC.info from a specific month
  python main.py marc-scrape --only 2026/02   # crawl MARC.info for one month only
  python main.py marc-scrape --to 2026/12     # crawl MARC.info up to a month
  python main.py embed                        # embed + ingest all crawled emails into Neon
  python main.py embed --from 2024/01         # embed emails from this month onward
  python main.py embed --provider openai      # use OpenAI embeddings (default: fastembed)
  python main.py summarize                    # generate Groq AI summaries for all threads
  python main.py clear-db                     # TRUNCATE all tables (run before full re-crawl)
  python main.py status                       # print crawl state summary
"""
import argparse
import asyncio
import json
import time
from datetime import datetime, timezone
from typing import Optional

import httpx

from config import BASE_URL, DATABASE_URL, MAX_CONCURRENT_MONTHS, OUTPUT_JSON_PATH, STATE_FILE_PATH
from logger import setup_logger
from scraper import (
    check_robots_txt,
    crawl_month,
    get_all_month_periods,
)
from storage import (
    load_crawl_state,
    read_all_emails,
    save_crawl_state,
    write_all_emails,
)
from thread_reconstructor import reconstruct_threads

logger = setup_logger()

_state_lock = asyncio.Lock()


# ---------------------------------------------------------------------------
# scrape
# ---------------------------------------------------------------------------

async def cmd_scrape(
    from_period: Optional[str] = None,
    to_period: Optional[str] = None,
    only_period: Optional[str] = None,
) -> None:
    """Crawl all HTML pages in parallel, with optional period filter."""
    start = time.time()
    total_emails = 0
    errors = 0

    async with httpx.AsyncClient(
        headers={"User-Agent": "pghackers-explorer/1.0"},
        follow_redirects=True,
        timeout=30,
    ) as client:

        # Respect robots.txt
        allowed = await check_robots_txt(client)
        if not allowed:
            logger.error("robots_txt_disallows_crawl")
            return

        periods = await get_all_month_periods(
            client,
            from_period=from_period,
            to_period=to_period,
            only_period=only_period,
        )
        state = load_crawl_state()
        completed = set(state.get("completed_months", []))

        pending = [(p, u) for p, u in periods if p not in completed]
        logger.info("pending_months", count=len(pending), completed=len(completed))

        async def crawl_month_with_state(period: str, index_url: str) -> int:
            nonlocal errors
            try:
                count = await crawl_month(client, period, index_url)
                async with _state_lock:
                    s = load_crawl_state()
                    done = set(s.get("completed_months", []))
                    done.add(period)
                    s["completed_months"] = list(done)
                    s["last_crawl"] = datetime.now(tz=timezone.utc).isoformat()
                    save_crawl_state(s)
                return count
            except Exception as e:
                logger.error("month_crawl_failed", period=period, error=str(e))
                errors += 1
                return 0

        # Process months in parallel batches
        for i in range(0, len(pending), MAX_CONCURRENT_MONTHS):
            batch = pending[i: i + MAX_CONCURRENT_MONTHS]
            logger.info(
                "processing_batch",
                batch_num=i // MAX_CONCURRENT_MONTHS + 1,
                months=[p for p, _ in batch],
            )
            results = await asyncio.gather(
                *[crawl_month_with_state(p, u) for p, u in batch]
            )
            total_emails += sum(results)

    # Second pass: reconstruct threads
    logger.info("starting_thread_reconstruction")
    all_emails = read_all_emails()
    updated = reconstruct_threads(all_emails)
    write_all_emails(updated)

    unique_roots = len({e.get("thread_root_id") for e in updated if e.get("thread_root_id")})

    logger.info(
        "crawl_complete",
        total_emails=total_emails,
        total_threads=unique_roots,
        months_processed=len(pending),
        errors=errors,
        duration_seconds=round(time.time() - start, 1),
    )


# ---------------------------------------------------------------------------
# marc-scrape — full archive via MARC.info (no 200/month cap)
# ---------------------------------------------------------------------------

async def cmd_marc_scrape(
    from_period: Optional[str] = None,
    to_period: Optional[str] = None,
    only_period: Optional[str] = None,
) -> None:
    """
    Crawl pgsql-hackers from MARC.info with full per-month email counts.

    MARC.info has no 200-email cap — Jan 2025 alone has 2,450 messages.
    Supports resume: already-completed months (tracked in crawl_state.json)
    are skipped automatically.

    Rate limiting: CRAWL_DELAY_SECONDS (1.5s) between requests + 3 concurrent
    max via semaphore + retry with backoff [2, 3, 5, 8, 15]s × 5 attempts.
    """
    from marc_scraper import get_all_marc_month_periods, run_marc_scrape_month

    start = time.time()
    total_emails = 0
    errors = 0

    state = load_crawl_state()
    completed = set(state.get("completed_months", []))

    async with httpx.AsyncClient(
        headers={
            "User-Agent": (
                "pghackers-explorer/1.0 "
                "(open-source archive reader; "
                "github.com/mohitmishra786/postgres-hackers-explorer)"
            )
        },
        follow_redirects=True,
        timeout=30,
    ) as client:

        periods = await get_all_marc_month_periods(
            client,
            from_period=from_period,
            to_period=to_period,
            only_period=only_period,
        )

        pending = [(p, y, m) for p, y, m in periods if p not in completed]
        logger.info(
            "marc_scrape_plan",
            total_months=len(periods),
            pending=len(pending),
            already_done=len(completed_months := completed),
        )

        for period, year, month in pending:
            try:
                count = await run_marc_scrape_month(client, period, year, month)
                total_emails += count

                # Checkpoint after each month — safe to resume if interrupted
                s = load_crawl_state()
                done = set(s.get("completed_months", []))
                done.add(period)
                s["completed_months"] = sorted(done)
                s["last_crawl"] = datetime.now(tz=timezone.utc).isoformat()
                s["source"] = "marc.info"
                save_crawl_state(s)

                logger.info(
                    "marc_month_checkpointed",
                    period=period,
                    emails=count,
                    total_so_far=total_emails,
                )
            except Exception as e:
                logger.error("marc_month_failed", period=period, error=str(e))
                errors += 1

    # Reconstruct thread structure from JSONL
    logger.info("starting_thread_reconstruction")
    all_emails = read_all_emails()
    updated = reconstruct_threads(all_emails)
    write_all_emails(updated)

    unique_roots = len({e.get("thread_root_id") for e in updated if e.get("thread_root_id")})

    logger.info(
        "marc_scrape_complete",
        total_emails=total_emails,
        total_threads=unique_roots,
        months_processed=len(pending),
        errors=errors,
        duration_seconds=round(time.time() - start, 1),
    )


# ---------------------------------------------------------------------------
# clear-db — TRUNCATE all tables (run before a full re-crawl from scratch)
# ---------------------------------------------------------------------------

def cmd_clear_db(confirm: bool = False) -> None:
    """
    TRUNCATE emails, threads, authors, patches and reset crawl state.

    This is irreversible. Use before a full re-crawl from MARC.info
    to avoid stale data from postgresql.org (200/month capped) crawl.
    """
    import psycopg2
    import os

    if not confirm:
        ans = input(
            "\n⚠️  This will DELETE all rows from emails, threads, authors, patches.\n"
            "   Also resets output/crawl_state.json and output/emails.jsonl.\n"
            "   Type 'yes' to confirm: "
        ).strip().lower()
        if ans != "yes":
            print("Aborted.")
            return

    # Clear DB tables
    db_url = DATABASE_URL
    if not db_url:
        raise RuntimeError("DATABASE_URL not set")

    conn = psycopg2.connect(db_url, connect_timeout=30)
    try:
        with conn.cursor() as cur:
            logger.info("truncating_tables")
            cur.execute("""
                TRUNCATE TABLE patches, authors, threads, emails
                RESTART IDENTITY CASCADE
            """)
        conn.commit()
        logger.info("tables_truncated")
    finally:
        conn.close()

    # Reset JSONL and crawl state
    import os as _os
    if _os.path.exists(OUTPUT_JSON_PATH):
        _os.remove(OUTPUT_JSON_PATH)
        logger.info("deleted_jsonl", path=OUTPUT_JSON_PATH)

    save_crawl_state({"completed_months": [], "last_crawl": None, "source": None})
    logger.info("crawl_state_reset")

    print("✓ Database cleared. Ready for full re-crawl.")


# ---------------------------------------------------------------------------
# incremental
# ---------------------------------------------------------------------------

async def cmd_incremental() -> None:
    """Only fetch months newer than the last completed crawl."""
    state = load_crawl_state()
    completed = state.get("completed_months", [])
    from_period: Optional[str] = None

    if completed:
        # Re-crawl the latest month (may have new emails mid-month) + everything newer
        latest = sorted(completed)[-1]
        from_period = latest
        logger.info("incremental_crawl_from", period=from_period)
    else:
        logger.info("no_prior_crawl_doing_full_scrape")

    await cmd_scrape(from_period=from_period)


# ---------------------------------------------------------------------------
# embed
# ---------------------------------------------------------------------------

async def cmd_embed(
    provider: str = "fastembed",
    batch_size: int = 250,
    from_period: Optional[str] = None,
    summarize: bool = False,
) -> None:
    """Run the embedding + ingestion pipeline."""
    from ingest import run as ingest_run

    await ingest_run(
        batch_size=batch_size,
        summarize=summarize,
        provider=provider,
        from_period=from_period,
    )


# ---------------------------------------------------------------------------
# summarize
# ---------------------------------------------------------------------------

async def cmd_summarize() -> None:
    """Generate AI thread summaries for all threads (Groq llama-3.1-8b-instant)."""
    from ingest import generate_thread_summaries, get_db_conn

    emails = read_all_emails()
    if not emails:
        logger.error("no_emails_found_for_summarization")
        return

    conn = get_db_conn()
    try:
        await generate_thread_summaries(emails, conn)
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# status
# ---------------------------------------------------------------------------

def cmd_status() -> None:
    """Print current crawl state summary."""
    import os

    state = load_crawl_state()
    completed = state.get("completed_months", [])
    last_crawl = state.get("last_crawl", "never")

    emails = read_all_emails()
    thread_ids = {e.get("thread_root_id") for e in emails if e.get("thread_root_id")}
    patch_count = sum(1 for e in emails if e.get("has_patch"))

    jsonl_size = "N/A"
    if os.path.exists(OUTPUT_JSON_PATH):
        size_mb = os.path.getsize(OUTPUT_JSON_PATH) / 1024 / 1024
        jsonl_size = f"{size_mb:.1f} MB"

    print(f"Last crawl:        {last_crawl}")
    print(f"Months completed:  {len(completed)}")
    if completed:
        print(f"  Earliest:        {min(completed)}")
        print(f"  Latest:          {max(completed)}")
    print(f"Total emails:      {len(emails)}")
    print(f"Total threads:     {len(thread_ids)}")
    print(f"Emails with patch: {patch_count}")
    print(f"JSONL size:        {jsonl_size}")
    print(f"State file:        {STATE_FILE_PATH}")


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="pghackers.com — PostgreSQL pgsql-hackers mailing list crawler",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    # -- scrape --
    scrape_parser = subparsers.add_parser(
        "scrape",
        help="Crawl all HTML archive pages from lists.postgresql.org",
    )
    scrape_parser.add_argument(
        "--from",
        dest="from_period",
        metavar="YYYY/MM",
        default=None,
        help="Start crawling from this month (e.g. 2024/01)",
    )
    scrape_parser.add_argument(
        "--to",
        dest="to_period",
        metavar="YYYY/MM",
        default=None,
        help="Stop crawling at this month inclusive (e.g. 2025/12)",
    )
    scrape_parser.add_argument(
        "--only",
        dest="only_period",
        metavar="YYYY/MM",
        default=None,
        help="Crawl only this specific month (e.g. 2026/02)",
    )

    # -- incremental --
    subparsers.add_parser(
        "incremental",
        help="Only fetch months newer than the last completed crawl",
    )

    # -- marc-scrape --
    marc_parser = subparsers.add_parser(
        "marc-scrape",
        help="Crawl full archive from MARC.info (no 200/month cap, resumable)",
    )
    marc_parser.add_argument(
        "--from", dest="from_period", metavar="YYYY/MM", default=None,
        help="Start from this month (e.g. 2026/01)",
    )
    marc_parser.add_argument(
        "--to", dest="to_period", metavar="YYYY/MM", default=None,
        help="Stop at this month inclusive (e.g. 2026/12)",
    )
    marc_parser.add_argument(
        "--only", dest="only_period", metavar="YYYY/MM", default=None,
        help="Crawl exactly one month (e.g. 2026/02)",
    )

    # -- clear-db --
    clear_parser = subparsers.add_parser(
        "clear-db",
        help="TRUNCATE all DB tables + reset crawl state (irreversible)",
    )
    clear_parser.add_argument(
        "--yes", dest="confirm", action="store_true",
        help="Skip interactive confirmation prompt",
    )

    # -- embed --
    embed_parser = subparsers.add_parser(
        "embed",
        help="Embed crawled emails and upsert into Supabase",
    )
    embed_parser.add_argument(
        "--provider",
        choices=["fastembed", "openai"],
        default="fastembed",
        help="Embedding provider (default: fastembed)",
    )
    embed_parser.add_argument(
        "--batch-size",
        type=int,
        default=250,
        help="Embedding batch size (default: 250)",
    )
    embed_parser.add_argument(
        "--from",
        dest="from_period",
        metavar="YYYY/MM",
        default=None,
        help="Only embed emails from this month onward",
    )
    embed_parser.add_argument(
        "--summarize",
        action="store_true",
        help="Also generate AI thread summaries (Groq llama-3.1-8b-instant)",
    )

    # -- summarize --
    subparsers.add_parser(
        "summarize",
        help="Generate AI summaries for all threads (Groq llama-3.1-8b-instant)",
    )

    # -- status --
    subparsers.add_parser(
        "status",
        help="Print crawl state summary",
    )

    # global
    parser.add_argument(
        "--log-level",
        default="INFO",
        choices=["DEBUG", "INFO", "WARNING", "ERROR"],
    )

    return parser


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()

    if args.command == "scrape":
        asyncio.run(cmd_scrape(
            from_period=args.from_period,
            to_period=args.to_period,
            only_period=args.only_period,
        ))

    elif args.command == "incremental":
        asyncio.run(cmd_incremental())

    elif args.command == "marc-scrape":
        asyncio.run(cmd_marc_scrape(
            from_period=args.from_period,
            to_period=args.to_period,
            only_period=args.only_period,
        ))

    elif args.command == "clear-db":
        cmd_clear_db(confirm=getattr(args, "confirm", False))

    elif args.command == "embed":
        asyncio.run(cmd_embed(
            provider=args.provider,
            batch_size=args.batch_size,
            from_period=args.from_period,
            summarize=args.summarize,
        ))

    elif args.command == "summarize":
        asyncio.run(cmd_summarize())

    elif args.command == "status":
        cmd_status()


if __name__ == "__main__":
    main()
