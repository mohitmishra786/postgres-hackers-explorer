# Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 15 (App Router), React 19, TypeScript |
| Styling | Tailwind CSS v3, Framer Motion |
| Database | Neon Postgres + pgvector (IVFFlat, 384 dims) |
| Cache / Rate limiting | Upstash Redis |
| Embeddings | HuggingFace BAAI/bge-small-en-v1.5 (free) |
| LLM | Groq - llama-3.3-70b-versatile (answers), llama-3.1-8b-instant (summaries) |
| Crawler | Python 3.11+, psycopg2, fastembed (local embeddings) |
