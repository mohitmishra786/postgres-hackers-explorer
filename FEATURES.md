# Features

- **Thread browser** - Paginated, sort by recency / activity / patches / committed, full-text filter
- **Thread detail** - Collapsible email tree, diff viewer with syntax highlighting, paginated for large threads (100 emails/page, 500 cap)
- **Patch dashboard** - All threads with patches, commitfest status badges, diff stats
- **Author directory** - Contributor profiles with email/patch/review counts
- **Keyword search** - PostgreSQL FTS (`plainto_tsquery`) with pagination
- **Semantic search** - Vector similarity via pgvector, results cached in Redis
- **Ask (RAG)** - Hybrid retrieval (vector + keyword), thread expansion, Groq LLM synthesis, cited sources
- **Retro terminal UI** - Phosphor green on black, JetBrains Mono, CRT scanlines
