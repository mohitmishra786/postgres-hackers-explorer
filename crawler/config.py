import os
from pathlib import Path

from dotenv import load_dotenv

_env_file = Path(__file__).parent.parent / ".env"
load_dotenv(_env_file)

BASE_URL = "https://www.postgresql.org/list/pgsql-hackers"
CRAWL_DELAY_SECONDS = 1.2        # be polite to the PostgreSQL servers
MAX_CONCURRENT_REQUESTS = 3      # conservative parallelism
MAX_CONCURRENT_MONTHS = 2        # crawl 2 months in parallel
MAX_RETRIES = 5
REQUEST_TIMEOUT = 30
RETRY_DELAY_BASE = 1.0

OUTPUT_DIR = "output"
OUTPUT_JSON_PATH = os.path.join(OUTPUT_DIR, "emails.jsonl")
STATE_FILE_PATH = os.path.join(OUTPUT_DIR, "crawl_state.json")

USER_AGENT = (
    "pghackers-explorer/1.0 "
    "(open-source archive reader; "
    "github.com/mohitmishra786/postgres-hackers-explorer)"
)

START_YEAR = 1997
START_MONTH = 6

# ---- Database (Neon Postgres) --------------------------------
# Use the pooled connection URL for the crawler / ingest pipeline.
# Neon provides both a pooled (PgBouncer) and unpooled URL;
# for bulk inserts from the crawler we use the unpooled one to
# avoid statement-cache size limits with pgvector literals.
DATABASE_URL = (
    os.environ.get("DATABASE_URL_UNPOOLED")
    or os.environ.get("DATABASE_URL")
    or os.environ.get("POSTGRES_URL_NON_POOLING")
    or os.environ.get("POSTGRES_URL")
    or ""
)

# ---- Groq (primary LLM — summarization) ---------------------
GROQ_API_KEY = os.environ.get("GROQ_API_KEY", "")
GROQ_SUMMARY_MODEL = "llama-3.1-8b-instant"   # fast, free tier

# ---- Embedding configuration --------------------------------
# EMBEDDING_PROVIDER controls which backend is used:
#   "fastembed"  (default) — local, no API key, BAAI/bge-small-en-v1.5, 384 dims
#   "openai"               — requires OPENAI_API_KEY, text-embedding-3-small, 1536 dims
EMBEDDING_PROVIDER = os.environ.get("EMBEDDING_PROVIDER", "fastembed")

FASTEMBED_MODEL = "BAAI/bge-small-en-v1.5"
FASTEMBED_DIMENSIONS = 384

OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "")
OPENAI_EMBEDDING_MODEL = "text-embedding-3-small"
OPENAI_EMBEDDING_DIMENSIONS = 1536

EMBEDDING_DIMENSIONS = (
    FASTEMBED_DIMENSIONS
    if EMBEDDING_PROVIDER == "fastembed"
    else OPENAI_EMBEDDING_DIMENSIONS
)

EMBEDDING_BATCH_SIZE = 250
MAX_EMBEDDING_TOKENS = 8000   # used only for OpenAI token-truncation
