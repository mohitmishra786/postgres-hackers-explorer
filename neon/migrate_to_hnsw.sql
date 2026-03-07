-- ============================================================
-- Migration: IVFFlat → HNSW for pgvector embeddings
-- Run this ONCE in the Neon SQL editor before the full 466k crawl.
--
-- WHY HNSW over IVFFlat at 466k rows:
--   IVFFlat requires tuning `lists` = sqrt(N) and probes at query time.
--   At 466k rows: lists should be ~682, and the index must be REBUILT
--   after significant data growth — otherwise recall collapses.
--   IVFFlat also cannot be built incrementally: it requires a full table scan.
--
--   HNSW (Hierarchical Navigable Small World):
--   - No rebuild ever needed as data grows
--   - ~2x better recall at same speed vs IVFFlat with defaults
--   - No per-session `SET ivfflat.probes` tuning needed
--   - m=16, ef_construction=128 are well-tested defaults for 384-dim text
--   - ef_search=100 at query time gives excellent recall (>99% vs brute force)
--
-- TIMING: Building HNSW on 466k rows takes ~10-20 min on Neon (background).
-- The old IVFFlat index is dropped first to free space during the build.
--
-- SAFE TO RUN while the table is being written to (CONCURRENTLY).
-- ============================================================

-- Step 1: Drop the old IVFFlat index (frees ~106 MB immediately)
DROP INDEX CONCURRENTLY IF EXISTS emails_embedding_idx;

-- Step 2: Build HNSW index
--   m             = 16   (neighbors per layer; 16 is standard for text)
--   ef_construction = 128 (candidates during build; higher = better recall, slower build)
--   cosine distance matches how we query: embedding <=> query
CREATE INDEX CONCURRENTLY emails_embedding_hnsw_idx
    ON emails
    USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 128);

-- Step 3: Set query-time ef_search for high recall
-- Add this to your postgresql.conf equivalent or set per-session in queries:
--   SET hnsw.ef_search = 100;
-- Default is 40. 100 gives >99% recall vs brute-force at minimal extra cost.
-- We handle this in the application queries directly (see rag.ts / semantic route).

-- ============================================================
-- Also tune the GIN FTS index for faster inserts at scale:
-- The existing index is fine — GIN is the correct type for tsvector.
-- No change needed there.
-- ============================================================

-- ============================================================
-- Verify
-- ============================================================
SELECT
    indexname,
    pg_size_pretty(pg_relation_size(indexname::regclass)) AS size,
    indexdef
FROM pg_indexes
WHERE tablename = 'emails'
  AND indexname IN ('emails_embedding_hnsw_idx', 'emails_fts_idx')
ORDER BY indexname;
