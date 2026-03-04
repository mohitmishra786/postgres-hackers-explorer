# API Reference

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
