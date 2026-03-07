"""
Embedding ingestion pipeline for pgsql-hackers emails.

Reads the JSONL output from the crawler, embeds each email with fastembed
(local, free, 384-dim BAAI/bge-small-en-v1.5), and upserts everything into
Neon Postgres using psycopg2.

Usage:
  python ingest.py                        # ingest all emails from output/emails.jsonl
  python ingest.py --summarize            # also generate Groq thread summaries
  python ingest.py --batch-size 50        # override embedding batch size
  python ingest.py --provider openai      # use OpenAI embeddings instead of fastembed
  python ingest.py --from 2024/01         # only ingest emails from this month onward
"""
import argparse
import asyncio
import json
import time
from collections import defaultdict
from datetime import datetime, timezone
from typing import Optional

import psycopg2
import psycopg2.extras
from groq import AsyncGroq
from openai import AsyncOpenAI
import tiktoken

from config import (
    DATABASE_URL,
    EMBEDDING_BATCH_SIZE,
    EMBEDDING_PROVIDER,
    FASTEMBED_MODEL,
    GROQ_API_KEY,
    GROQ_SUMMARY_MODEL,
    MAX_EMBEDDING_TOKENS,
    OPENAI_API_KEY,
    OPENAI_EMBEDDING_MODEL,
    OPENAI_EMBEDDING_DIMENSIONS,
    OUTPUT_JSON_PATH,
)
from logger import setup_logger
from storage import read_all_emails

logger = setup_logger()

# ---------------------------------------------------------------------------
# Clients
# ---------------------------------------------------------------------------

groq_client = AsyncGroq(api_key=GROQ_API_KEY or "no-key")
openai_client = AsyncOpenAI(api_key=OPENAI_API_KEY or "no-key")


def get_db_conn() -> psycopg2.extensions.connection:
    """Open a new psycopg2 connection to Neon Postgres."""
    if not DATABASE_URL:
        raise RuntimeError("DATABASE_URL is not set — check your .env file")
    return psycopg2.connect(DATABASE_URL, connect_timeout=30)


# ---------------------------------------------------------------------------
# Token counting / truncation (OpenAI embeddings only)
# ---------------------------------------------------------------------------

_encoder: Optional[tiktoken.Encoding] = None


def get_encoder() -> tiktoken.Encoding:
    global _encoder
    if _encoder is None:
        _encoder = tiktoken.encoding_for_model("text-embedding-3-small")
    return _encoder


def truncate_to_tokens(text: str, max_tokens: int = MAX_EMBEDDING_TOKENS) -> tuple[str, int]:
    enc = get_encoder()
    tokens = enc.encode(text)
    if len(tokens) <= max_tokens:
        return text, len(tokens)
    return enc.decode(tokens[:max_tokens]), max_tokens


def build_embedding_text(email: dict) -> str:
    """
    Build the document text for embedding.

    BGE best practice (from official BAAI/bge-small-en-v1.5 docs):
    - Documents/passages: embed as-is, NO instruction prefix.
    - Only queries get the prefix "Represent this sentence for searching relevant passages: "
    - Subject prepended so retrieval works on thread-topic queries too.
    - Capped at ~2000 chars: BGE-small has a 512-token window; beyond that
      the model truncates anyway, so we save compute and keep signal dense.
    """
    subject = (email.get("subject", "") or "").strip()
    body = (email.get("body_new_content", "") or email.get("body_clean", "") or "").strip()
    # Join subject + body; truncate body to keep total well within 512 tokens (~2000 chars)
    combined = f"{subject}\n\n{body}"
    return combined[:2000].strip()


# ---------------------------------------------------------------------------
# Embedding backends
# ---------------------------------------------------------------------------

async def embed_batch_openai(texts: list[str]) -> list[list[float]]:
    response = await openai_client.embeddings.create(
        model=OPENAI_EMBEDDING_MODEL,
        input=texts,
        dimensions=OPENAI_EMBEDDING_DIMENSIONS,
    )
    return [item.embedding for item in response.data]


def embed_batch_fastembed(texts: list[str]) -> list[list[float]]:
    """
    Local fastembed — BAAI/bge-small-en-v1.5, 384 dims, no API key.

    fastembed automatically:
    - Normalises embeddings to unit length (required for cosine similarity)
    - Handles tokenisation and CLS pooling correctly
    - Does NOT add any instruction prefix (correct for documents/passages)
    """
    from fastembed import TextEmbedding  # lazy import
    # Re-use model across batches within a run for efficiency
    model = TextEmbedding(model_name=FASTEMBED_MODEL)
    return [emb.tolist() for emb in model.embed(texts)]


async def embed_emails(
    emails: list[dict],
    batch_size: int = EMBEDDING_BATCH_SIZE,
    provider: str = EMBEDDING_PROVIDER,
) -> list[dict]:
    total = len(emails)
    logger.info("starting_embedding", total_emails=total, provider=provider)

    for batch_start in range(0, total, batch_size):
        batch = emails[batch_start: batch_start + batch_size]

        if provider == "openai":
            texts, token_counts = [], []
            for email in batch:
                text, n = truncate_to_tokens(build_embedding_text(email))
                texts.append(text)
                token_counts.append(n)
            try:
                embeddings = await embed_batch_openai(texts)
                for email, emb in zip(batch, embeddings):
                    email["embedding"] = emb
            except Exception as e:
                logger.error("embedding_batch_failed_openai", batch_start=batch_start, error=str(e))
        else:
            texts = [build_embedding_text(e) for e in batch]
            try:
                embeddings = embed_batch_fastembed(texts)
                for email, emb in zip(batch, embeddings):
                    email["embedding"] = emb
            except Exception as e:
                logger.error("embedding_batch_failed_fastembed", batch_start=batch_start, error=str(e))

        batch_num = batch_start // batch_size + 1
        total_batches = (total + batch_size - 1) // batch_size
        logger.info(
            "embedding_batch_complete",
            batch_number=batch_num,
            total_batches=total_batches,
            emails_embedded=min(batch_start + batch_size, total),
        )

    return emails


# ---------------------------------------------------------------------------
# Neon upsert — emails
# ---------------------------------------------------------------------------

def _to_pg_array(items: list) -> str:
    """Convert a Python list of strings to a Postgres text[] literal: {"a","b"}."""
    if not items:
        return "{}"
    escaped = ['"' + str(item).replace('"', '\\"') + '"' for item in items]
    return "{" + ",".join(escaped) + "}"


# PostgreSQL rejects NUL bytes (0x00) in text columns, and the tsvector index
# has a hard cap of 1 MB (1,048,575 bytes).  Strip NUL bytes everywhere and
# truncate fields that feed into the FTS index.
_FTS_MAX_BYTES = 900_000   # leave headroom below the 1,048,575-byte tsvector cap


def sanitize_text(text: str | None, max_bytes: int | None = None) -> str | None:
    """Strip NUL bytes from text and optionally truncate to max_bytes (UTF-8)."""
    if text is None:
        return None
    text = text.replace("\x00", "")          # PostgreSQL rejects 0x00 in text
    if max_bytes is not None:
        encoded = text.encode("utf-8")
        if len(encoded) > max_bytes:
            text = encoded[:max_bytes].decode("utf-8", errors="ignore")
    return text


def email_to_row(email: dict) -> tuple:
    """Return a tuple matching the INSERT column order below."""
    embedding = email.get("embedding")
    # Format as Postgres vector literal string: '[0.1,0.2,...]'
    embedding_str = f"[{','.join(str(x) for x in embedding)}]" if embedding else None
    # Format references as Postgres array literal: {"id1","id2",...}
    refs = email.get("references") or []
    if isinstance(refs, str):
        try:
            refs = json.loads(refs)
        except Exception:
            refs = []
    return (
        sanitize_text(email.get("message_id", "")),
        sanitize_text(email.get("in_reply_to")),
        _to_pg_array(refs),                                # text[] as Postgres array literal
        sanitize_text(email.get("subject", "")),
        sanitize_text(email.get("author_name")),
        sanitize_text(email.get("author_email_obfuscated")),
        email.get("date"),
        sanitize_text(email.get("body_clean"), max_bytes=_FTS_MAX_BYTES),        # FTS index cap
        sanitize_text(email.get("body_new_content"), max_bytes=_FTS_MAX_BYTES),  # FTS index cap
        sanitize_text(email.get("source_url")),
        sanitize_text(email.get("month_period")),
        sanitize_text(email.get("thread_root_id")),
        email.get("thread_depth", 0),
        bool(email.get("has_patch", False)),
        sanitize_text(email.get("patch_version")),
        _to_pg_array(email.get("git_commit_refs") or []),  # text[] as Postgres array literal
        embedding_str,
    )


def upsert_emails_neon(emails: list[dict], conn: psycopg2.extensions.connection) -> int:
    BATCH = 500
    total_upserted = 0

    with conn.cursor() as cur:
        for i in range(0, len(emails), BATCH):
            batch = emails[i: i + BATCH]
            rows = [email_to_row(e) for e in batch]
            INSERT_SQL = """
                    INSERT INTO emails (
                        message_id, in_reply_to, references_ids, subject,
                        author_name, author_email, date, body_clean,
                        body_new_content, source_url, month_period,
                        thread_root_id, thread_depth, has_patch, patch_version,
                        git_commit_refs, embedding
                    ) VALUES %s
                    ON CONFLICT (message_id) DO UPDATE SET
                        in_reply_to      = EXCLUDED.in_reply_to,
                        references_ids   = EXCLUDED.references_ids,
                        subject          = EXCLUDED.subject,
                        author_name      = EXCLUDED.author_name,
                        author_email     = EXCLUDED.author_email,
                        date             = EXCLUDED.date,
                        body_clean       = EXCLUDED.body_clean,
                        body_new_content = EXCLUDED.body_new_content,
                        source_url       = EXCLUDED.source_url,
                        month_period     = EXCLUDED.month_period,
                        thread_root_id   = EXCLUDED.thread_root_id,
                        thread_depth     = EXCLUDED.thread_depth,
                        has_patch        = EXCLUDED.has_patch,
                        patch_version    = EXCLUDED.patch_version,
                        git_commit_refs  = EXCLUDED.git_commit_refs,
                        embedding        = EXCLUDED.embedding
                    """
            TEMPLATE = """(
                        %s, %s, %s::text[], %s,
                        %s, %s, %s::timestamptz, %s,
                        %s, %s, %s,
                        %s, %s, %s, %s,
                        %s::text[], %s::vector
                    )"""
            try:
                psycopg2.extras.execute_values(cur, INSERT_SQL, rows, template=TEMPLATE)
                conn.commit()
                total_upserted += len(rows)
                logger.info("upserted_email_batch", batch_start=i, count=len(rows), total=total_upserted)
            except Exception as e:
                conn.rollback()
                logger.warning("email_batch_failed_trying_one_by_one", batch_start=i, error=str(e))
                # Fall back to row-by-row so one bad email doesn't lose the whole batch
                for j, row in enumerate(rows):
                    try:
                        psycopg2.extras.execute_values(cur, INSERT_SQL, [row], template=TEMPLATE)
                        conn.commit()
                        total_upserted += 1
                    except Exception as row_err:
                        conn.rollback()
                        logger.error(
                            "email_row_failed",
                            batch_start=i,
                            row_index=j,
                            message_id=row[0],
                            error=str(row_err),
                        )

    return total_upserted


# ---------------------------------------------------------------------------
# Neon upsert — authors
# ---------------------------------------------------------------------------

def upsert_authors_neon(emails: list[dict], conn: psycopg2.extensions.connection) -> None:
    author_data: dict[str, dict] = defaultdict(lambda: {
        "email_count": 0,
        "patch_count": 0,
        "first_seen": None,
        "last_seen": None,
        "email_obfuscated": None,
    })

    for email in emails:
        name = email.get("author_name", "Unknown") or "Unknown"
        date_val = email.get("date")

        if isinstance(date_val, str):
            try:
                date = datetime.fromisoformat(date_val)
                if date.tzinfo is None:
                    date = date.replace(tzinfo=timezone.utc)
            except Exception:
                date = None
        elif isinstance(date_val, datetime):
            date = date_val.replace(tzinfo=timezone.utc) if date_val.tzinfo is None else date_val
        else:
            date = None

        d = author_data[name]
        d["email_count"] += 1
        d["email_obfuscated"] = d["email_obfuscated"] or email.get("author_email_obfuscated")
        if email.get("has_patch"):
            d["patch_count"] += 1
        if date:
            if d["first_seen"] is None or date < d["first_seen"]:
                d["first_seen"] = date
            if d["last_seen"] is None or date > d["last_seen"]:
                d["last_seen"] = date

    rows = [
        (
            name,
            data["email_obfuscated"],
            data["email_count"],
            data["patch_count"],
            data["first_seen"].isoformat() if data["first_seen"] else None,
            data["last_seen"].isoformat() if data["last_seen"] else None,
        )
        for name, data in author_data.items()
        if name and name != "Unknown"
    ]

    BATCH = 100
    with conn.cursor() as cur:
        for i in range(0, len(rows), BATCH):
            try:
                psycopg2.extras.execute_values(
                    cur,
                    """
                    INSERT INTO authors (name, email_obfuscated, email_count, patch_count, first_seen, last_seen)
                    VALUES %s
                    ON CONFLICT (name) DO UPDATE SET
                        email_obfuscated = EXCLUDED.email_obfuscated,
                        email_count      = GREATEST(authors.email_count, EXCLUDED.email_count),
                        patch_count      = GREATEST(authors.patch_count, EXCLUDED.patch_count),
                        first_seen       = LEAST(authors.first_seen, EXCLUDED.first_seen::timestamptz),
                        last_seen        = GREATEST(authors.last_seen, EXCLUDED.last_seen::timestamptz)
                    """,
                    rows[i: i + BATCH],
                    template="(%s, %s, %s, %s, %s::timestamptz, %s::timestamptz)",
                )
                conn.commit()
            except Exception as e:
                conn.rollback()
                logger.error("author_upsert_failed", batch_start=i, error=str(e))

    logger.info("authors_upserted", count=len(rows))


# ---------------------------------------------------------------------------
# Neon upsert — patches
# ---------------------------------------------------------------------------

def upsert_patches_neon(emails: list[dict], conn: psycopg2.extensions.connection) -> None:
    patch_emails = [e for e in emails if e.get("has_patch")]
    if not patch_emails:
        logger.info("no_patches_to_upsert")
        return

    rows = [
        (
            e["message_id"],
            e.get("thread_root_id"),
            e.get("author_name"),
            e.get("date"),
            e.get("patch_version"),
            e.get("patch_filename"),
            e.get("patch_content"),
            json.dumps({
                "lines_added":   e.get("patch_lines_added", 0),
                "lines_removed": e.get("patch_lines_removed", 0),
                "files_changed": e.get("patch_files_changed", 0),
            }),
        )
        for e in patch_emails
    ]

    with conn.cursor() as cur:
        BATCH = 250
        for i in range(0, len(rows), BATCH):
            try:
                psycopg2.extras.execute_values(
                    cur,
                    """
                    INSERT INTO patches (
                        message_id, thread_root_id,
                        author_name, submitted_at, version,
                        filename, content, diff_stats
                    )
                    VALUES %s
                    ON CONFLICT (message_id) DO UPDATE SET
                        thread_root_id = EXCLUDED.thread_root_id,
                        author_name    = EXCLUDED.author_name,
                        submitted_at   = EXCLUDED.submitted_at,
                        version        = EXCLUDED.version,
                        filename       = EXCLUDED.filename,
                        content        = EXCLUDED.content,
                        diff_stats     = EXCLUDED.diff_stats
                    """,
                    rows[i: i + BATCH],
                    template="(%s, %s, %s, %s::timestamptz, %s, %s, %s, %s::jsonb)",
                )
                conn.commit()
            except Exception as e:
                conn.rollback()
                logger.error("patch_upsert_failed", batch_start=i, error=str(e))

    logger.info("patches_upserted", count=len(patch_emails))


# ---------------------------------------------------------------------------
# Thread stats — call upsert_thread_stats() SQL function
# ---------------------------------------------------------------------------

def rebuild_thread_stats_neon(emails: list[dict], conn: psycopg2.extensions.connection) -> None:
    root_ids = list({e.get("thread_root_id") for e in emails if e.get("thread_root_id")})
    logger.info("rebuilding_thread_stats", thread_count=len(root_ids))

    with conn.cursor() as cur:
        for root_id in root_ids:
            try:
                cur.execute("SELECT upsert_thread_stats(%s)", (root_id,))
                conn.commit()
            except Exception as e:
                conn.rollback()
                logger.warning("thread_stats_failed", root_id=root_id, error=str(e))

    logger.info("thread_stats_rebuilt", count=len(root_ids))


# ---------------------------------------------------------------------------
# Thread summarization — Groq llama-3.1-8b-instant (free tier)
# ---------------------------------------------------------------------------

SUMMARY_PROMPT = """Summarize this pgsql-hackers thread in 2-3 sentences. Cover: what it's about, main positions, and outcome/status.

Subject: {subject}
Participants ({count} emails): {names}

{concatenated_new_content}

Summary:"""


async def summarize_thread_groq(thread_emails: list[dict]) -> Optional[str]:
    if not thread_emails:
        return None

    thread_sorted = sorted(thread_emails, key=lambda e: e.get("date", ""))
    subject = thread_sorted[0].get("subject", "")
    names = list({e.get("author_name", "Unknown") for e in thread_sorted})[:6]

    # Keep prompt small: ~1500 chars of content max (≈375 tokens) + overhead ≈ 500 tokens total
    content_parts: list[str] = []
    total_chars = 0
    for e in thread_sorted:
        body = (e.get("body_new_content", "") or "").strip()
        if not body:
            continue
        if total_chars + len(body) > 1500:
            remaining = 1500 - total_chars
            if remaining > 80:
                content_parts.append(f"[{e.get('author_name', '?')}]: {body[:remaining]}…")
            break
        content_parts.append(f"[{e.get('author_name', '?')}]: {body}")
        total_chars += len(body)

    if not content_parts:
        return None

    prompt = SUMMARY_PROMPT.format(
        subject=subject,
        count=len(thread_emails),
        names=", ".join(names),
        concatenated_new_content="\n\n".join(content_parts),
    )

    try:
        response = await groq_client.chat.completions.create(
            model=GROQ_SUMMARY_MODEL,
            max_tokens=200,  # short summary, keep token cost low
            messages=[{"role": "user", "content": prompt}],
        )
        return response.choices[0].message.content if response.choices else None
    except Exception as e:
        logger.warning("summarize_thread_failed", subject=subject, error=str(e))
        return None


async def generate_thread_summaries(emails: list[dict], conn: psycopg2.extensions.connection) -> None:
    threads: dict[str, list[dict]] = defaultdict(list)
    for email in emails:
        root_id = email.get("thread_root_id")
        if root_id:
            threads[root_id].append(email)

    logger.info("generating_thread_summaries", thread_count=len(threads))

    # Groq free-tier limits for llama-3.1-8b-instant:
    #   TPM: 6,000  |  TPD: 500,000  |  RPM: 30
    # We use ~800 tokens per request (prompt ~600 + completion 512 max).
    # Safe rate: 1 request every 3s ≈ 20 RPM, ~16K TPM — well within TPM limit.
    # We also track estimated tokens per minute and pause when approaching limit.
    INTER_REQUEST_DELAY = 3.0     # seconds between requests (≈20 RPM)
    TPM_LIMIT = 5500              # conservative TPM limit (true limit 6000)
    TOKENS_PER_REQUEST_EST = 800  # estimated tokens per summarize call
    minute_token_bucket: list[tuple[float, int]] = []  # (timestamp, tokens)

    def tokens_used_last_minute() -> int:
        now = time.time()
        cutoff = now - 60.0
        # Prune old entries
        while minute_token_bucket and minute_token_bucket[0][0] < cutoff:
            minute_token_bucket.pop(0)
        return sum(t for _, t in minute_token_bucket)

    done = 0
    skipped = 0
    with conn.cursor() as cur:
        for root_id, thread_emails in threads.items():
            # Check if TPM budget is close to limit — if so, wait for the window to roll
            used = tokens_used_last_minute()
            if used + TOKENS_PER_REQUEST_EST > TPM_LIMIT:
                wait_secs = 62  # wait just over a minute for bucket to reset
                logger.info("tpm_throttle_wait", tokens_used_last_minute=used, wait_seconds=wait_secs)
                await asyncio.sleep(wait_secs)
                # Clear stale bucket entries
                now = time.time()
                while minute_token_bucket and minute_token_bucket[0][0] < now - 60.0:
                    minute_token_bucket.pop(0)

            try:
                summary = await summarize_thread_groq(thread_emails)
                if not summary:
                    skipped += 1
                    await asyncio.sleep(INTER_REQUEST_DELAY)
                    continue
                minute_token_bucket.append((time.time(), TOKENS_PER_REQUEST_EST))
                cur.execute(
                    "UPDATE threads SET summary = %s WHERE root_message_id = %s",
                    (summary, root_id),
                )
                conn.commit()
                done += 1
                logger.info("summarized_thread", done=done, skipped=skipped, total=len(threads))
            except Exception as e:
                conn.rollback()
                logger.error("thread_summary_failed", root_id=root_id, error=str(e))
                skipped += 1

            await asyncio.sleep(INTER_REQUEST_DELAY)

    logger.info("thread_summaries_complete", done=done, skipped=skipped)


# ---------------------------------------------------------------------------
# Main runner
# ---------------------------------------------------------------------------

async def run(
    batch_size: int,
    summarize: bool,
    provider: str,
    from_period: Optional[str] = None,
) -> None:
    start = time.time()

    logger.info("loading_emails", path=OUTPUT_JSON_PATH)
    all_emails = read_all_emails()
    logger.info("emails_loaded", count=len(all_emails))

    if not all_emails:
        logger.error("no_emails_to_ingest")
        return

    emails = all_emails
    if from_period:
        emails = [e for e in all_emails if (e.get("month_period") or "") >= from_period]
        logger.info("filtered_by_period", from_period=from_period, count=len(emails))

    if not emails:
        logger.warning("no_emails_after_filter", from_period=from_period)
        return

    # Step 1: Embed
    emails = await embed_emails(emails, batch_size=batch_size, provider=provider)

    # Step 2-5: Upsert to Neon
    conn = get_db_conn()
    try:
        upserted = upsert_emails_neon(emails, conn)
        logger.info("emails_upserted", count=upserted)

        upsert_authors_neon(emails, conn)
        upsert_patches_neon(emails, conn)
        rebuild_thread_stats_neon(emails, conn)

        if summarize:
            await generate_thread_summaries(emails, conn)
    finally:
        conn.close()

    logger.info(
        "ingestion_complete",
        total_emails=len(emails),
        duration_seconds=round(time.time() - start, 1),
    )


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Ingest pgsql-hackers emails into Neon Postgres with embeddings"
    )
    parser.add_argument("--batch-size", type=int, default=EMBEDDING_BATCH_SIZE)
    parser.add_argument(
        "--summarize", action="store_true",
        help="Generate Groq thread summaries (free, uses GROQ_API_KEY)",
    )
    parser.add_argument(
        "--provider", choices=["fastembed", "openai"], default=EMBEDDING_PROVIDER,
        help="Embedding provider: fastembed (default, local) or openai",
    )
    parser.add_argument(
        "--from", dest="from_period", metavar="YYYY/MM", default=None,
        help="Only ingest emails from this month onward (e.g. 2024/01)",
    )
    args = parser.parse_args()
    asyncio.run(run(
        batch_size=args.batch_size,
        summarize=args.summarize,
        provider=args.provider,
        from_period=args.from_period,
    ))


if __name__ == "__main__":
    main()
