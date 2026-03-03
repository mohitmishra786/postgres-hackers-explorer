# pghackers.dev

AI-powered reader and explorer for the [pgsql-hackers](https://lists.postgresql.org/pgsql-hackers/) mailing list archive.

Browse 700k+ emails, explore patches by commitfest status, and ask natural language questions answered via RAG over the full archive.

## Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 15 (App Router), React 19, TypeScript |
| Styling | Tailwind CSS v3, Framer Motion |
| Database | Neon Postgres + pgvector (IVFFlat, 384 dims) |
| Cache / Rate limiting | Upstash Redis |
| Embeddings | HuggingFace BAAI/bge-small-en-v1.5 (free) |
| LLM | Groq — llama-3.3-70b-versatile (answers), llama-3.1-8b-instant (summaries) |
| Crawler | Python 3.11+, psycopg2, fastembed (local embeddings) |

## Features

- **Thread browser** — paginated, sort by recency / activity / patches / committed, full-text filter
- **Thread detail** — collapsible email tree, diff viewer with syntax highlighting, paginated for large threads (100 emails/page, 500 cap)
- **Patch dashboard** — all threads with patches, commitfest status badges, diff stats
- **Author directory** — contributor profiles with email/patch/review counts
- **Keyword search** — PostgreSQL FTS (`plainto_tsquery`) with pagination
- **Semantic search** — vector similarity via pgvector, results cached in Redis
- **Ask (RAG)** — hybrid retrieval (vector + keyword), thread expansion, Groq LLM synthesis, cited sources
- **Retro terminal UI** — phosphor green on black, JetBrains Mono, CRT scanlines

## Getting Started

### 1. Clone and install

```bash
git clone https://github.com/chessman/postgres-hackers-explorer
cd postgres-hackers-explorer
npm install
```

### 2. Environment variables

Copy `.env.example` to `.env` and fill in:

```bash
cp .env.example .env
```

Required:

```
DATABASE_URL=           # Neon Postgres pooled (PgBouncer)
DATABASE_URL_UNPOOLED=  # Neon Postgres direct (used by crawler)
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
GROQ_API_KEY=
HUGGINGFACE_API_KEY=    # optional — public endpoint works without key
```

### 3. Set up the database

Run the schema in Neon SQL editor (or via `psql`):

```bash
psql $DATABASE_URL_UNPOOLED -f neon/schema.sql
```

### 4. Run the crawler

```bash
cd crawler
pip install -r requirements.txt
python main.py --months 3          # last 3 months
python main.py --all               # full archive (slow)
```

The crawler scrapes `lists.postgresql.org/pgsql-hackers/`, generates embeddings locally via `fastembed`, and bulk-upserts into Neon.

### 5. Start the dev server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Project Structure

```
app/
  page.tsx                  # Home
  threads/page.tsx          # Thread browser
  threads/[id]/page.tsx     # Thread detail (tree + patches)
  ask/page.tsx              # RAG question answering
  search/page.tsx           # Keyword + semantic search
  patches/page.tsx          # Patch dashboard
  authors/page.tsx          # Contributor directory
  authors/[name]/page.tsx   # Author profile
  api/                      # All API routes (force-dynamic)

lib/
  db.ts                     # Neon client singleton + TypeScript types
  embeddings.ts             # HuggingFace embedding (384-dim)
  rag.ts                    # 7-step RAG pipeline (vector+FTS+Groq)
  ratelimit.ts              # Upstash rate limiting + Redis cache helpers
  utils.ts                  # Date, tree builder, badge helpers

components/                 # UI components (retro terminal aesthetic)
crawler/                    # Python scraper + ingest pipeline
neon/schema.sql             # Database schema (pgvector, IVFFlat)
```

## API Reference

All routes are `force-dynamic` (no static caching).

| Method | Route | Description |
|---|---|---|
| GET | `/api/threads` | Paginated thread list (`page`, `per_page≤50`, `sort`, `filter`, `search`) |
| GET | `/api/threads/[id]` | Thread + emails (`page`, `per_page≤100`, max 500 emails) |
| GET | `/api/emails/[id]` | Single email by message_id |
| GET | `/api/search/keyword` | FTS search (`q`, `page`, `per_page≤20`, max offset 1000) |
| POST | `/api/search/semantic` | Vector search (`{query}`, `page`, max 3 pages of 20) |
| POST | `/api/ask` | RAG answer (`{question}`, rate-limited 10/min) |
| GET | `/api/patches` | Paginated patch threads (`page`, `per_page≤50`, `sort`, `search`) |
| GET | `/api/patches/[thread_id]` | Patches for a thread |
| GET | `/api/authors` | Paginated authors (`page`, `per_page≤50`, `sort`, `search`) |
| GET | `/api/stats` | Archive stats (cached 10min) |
| GET | `/api/commitfest` | Commitfest threads (`page`, `status`) |

## Deployment

Deploy on [Vercel](https://vercel.com) — connect the repo and set environment variables. The `vercel.json` is already configured.

The GitHub Actions workflow (`.github/workflows/crawler.yml`) runs the crawler on a schedule to keep the archive fresh.

## License

MIT
