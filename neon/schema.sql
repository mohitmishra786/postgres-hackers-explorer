-- ============================================================
-- pghackers.dev — Neon Postgres Schema
-- Run this once in the Neon SQL editor (or psql) to set up the database.
-- No Supabase-specific extensions (auth, RLS) — plain Postgres.
-- ============================================================

-- pgvector: required for 384-dim BAAI/bge-small-en-v1.5 embeddings
CREATE EXTENSION IF NOT EXISTS vector;

-- ============================================================
-- EMAILS — primary data store
-- ============================================================
CREATE TABLE IF NOT EXISTS emails (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id       TEXT        UNIQUE NOT NULL,
  in_reply_to      TEXT,
  references_ids   TEXT[],
  subject          TEXT        NOT NULL,
  author_name      TEXT,
  author_email     TEXT,
  date             TIMESTAMPTZ NOT NULL,
  body_clean       TEXT,
  body_new_content TEXT,
  source_url       TEXT,
  month_period     TEXT,
  thread_root_id   TEXT,
  thread_depth     INTEGER     DEFAULT 0,
  has_patch        BOOLEAN     DEFAULT FALSE,
  patch_version    TEXT,
  git_commit_refs  TEXT[],
  -- fastembed BAAI/bge-small-en-v1.5 = 384 dims
  -- switch to vector(1536) if you use EMBEDDING_PROVIDER=openai
  embedding        VECTOR(384),
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- THREADS — one row per thread root, maintained by upsert_thread_stats()
-- ============================================================
CREATE TABLE IF NOT EXISTS threads (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  root_message_id   TEXT        UNIQUE NOT NULL,
  subject           TEXT        NOT NULL,
  participant_count INTEGER     DEFAULT 0,
  message_count     INTEGER     DEFAULT 0,
  date_start        TIMESTAMPTZ,
  date_end          TIMESTAMPTZ,
  summary           TEXT,                      -- filled by Groq summarization
  tags              TEXT[],
  has_patches       BOOLEAN     DEFAULT FALSE,
  patch_count       INTEGER     DEFAULT 0,
  commitfest_status TEXT,
  commitfest_id     TEXT,
  commitfest_url    TEXT,
  pg_version_target TEXT,
  is_committed      BOOLEAN     DEFAULT FALSE,
  commit_hash       TEXT,
  commit_url        TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- AUTHORS
-- ============================================================
CREATE TABLE IF NOT EXISTS authors (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name             TEXT        NOT NULL,
  email_obfuscated TEXT,
  email_count      INTEGER     DEFAULT 0,
  patch_count      INTEGER     DEFAULT 0,
  review_count     INTEGER     DEFAULT 0,
  first_seen       TIMESTAMPTZ,
  last_seen        TIMESTAMPTZ,
  topic_tags       TEXT[],
  company          TEXT,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS authors_name_idx ON authors (name);

-- ============================================================
-- PATCHES
-- ============================================================
CREATE TABLE IF NOT EXISTS patches (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_root_id TEXT        NOT NULL,
  message_id     TEXT        NOT NULL,
  version        TEXT,
  filename       TEXT,
  content        TEXT,
  diff_stats     JSONB,
  submitted_at   TIMESTAMPTZ,
  author_name    TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS patches_message_id_idx ON patches (message_id);

-- ============================================================
-- INDEXES
-- ============================================================

-- Full-text search on subject + body (used by search_emails_fts)
CREATE INDEX IF NOT EXISTS emails_fts_idx
  ON emails
  USING GIN (
    to_tsvector('english',
      COALESCE(subject, '') || ' ' || COALESCE(body_new_content, '')
    )
  );

-- Vector similarity search with cosine distance (IVFFlat)
-- Tune lists= to ~sqrt(row_count) once you have data.
-- Re-run CREATE INDEX after significant data growth.
CREATE INDEX IF NOT EXISTS emails_embedding_idx
  ON emails
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

-- Standard B-tree indexes
CREATE INDEX IF NOT EXISTS emails_date_idx        ON emails (date);
CREATE INDEX IF NOT EXISTS emails_thread_idx      ON emails (thread_root_id);
CREATE INDEX IF NOT EXISTS emails_author_idx      ON emails (author_name);
CREATE INDEX IF NOT EXISTS emails_month_idx       ON emails (month_period);
CREATE INDEX IF NOT EXISTS emails_patch_idx       ON emails (has_patch) WHERE has_patch = TRUE;
CREATE INDEX IF NOT EXISTS threads_date_start_idx ON threads (date_start DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS threads_date_end_idx   ON threads (date_end   DESC NULLS LAST);

-- ============================================================
-- FUNCTIONS
-- ============================================================

-- Vector similarity search
CREATE OR REPLACE FUNCTION match_emails(
  query_embedding  VECTOR(384),
  match_threshold  FLOAT       DEFAULT 0.25,
  match_count      INT         DEFAULT 20,
  filter_date_from TIMESTAMPTZ DEFAULT NULL,
  filter_date_to   TIMESTAMPTZ DEFAULT NULL,
  filter_author    TEXT        DEFAULT NULL
)
RETURNS TABLE (
  id               UUID,
  message_id       TEXT,
  subject          TEXT,
  author_name      TEXT,
  author_email     TEXT,
  date             TIMESTAMPTZ,
  body_new_content TEXT,
  source_url       TEXT,
  thread_root_id   TEXT,
  thread_depth     INTEGER,
  has_patch        BOOLEAN,
  patch_version    TEXT,
  similarity       FLOAT
)
LANGUAGE SQL STABLE
AS $$
  SELECT
    e.id,
    e.message_id,
    e.subject,
    e.author_name,
    e.author_email,
    e.date,
    e.body_new_content,
    e.source_url,
    e.thread_root_id,
    e.thread_depth,
    e.has_patch,
    e.patch_version,
    1 - (e.embedding <=> query_embedding) AS similarity
  FROM emails e
  WHERE
    e.embedding IS NOT NULL
    AND 1 - (e.embedding <=> query_embedding) > match_threshold
    AND (filter_date_from IS NULL OR e.date >= filter_date_from)
    AND (filter_date_to   IS NULL OR e.date <= filter_date_to)
    AND (filter_author    IS NULL OR e.author_name ILIKE '%' || filter_author || '%')
  ORDER BY e.embedding <=> query_embedding
  LIMIT match_count;
$$;

-- Full-text keyword search
CREATE OR REPLACE FUNCTION search_emails_fts(
  search_query     TEXT,
  match_count      INT         DEFAULT 20,
  offset_val       INT         DEFAULT 0,
  filter_date_from TIMESTAMPTZ DEFAULT NULL,
  filter_date_to   TIMESTAMPTZ DEFAULT NULL,
  filter_author    TEXT        DEFAULT NULL
)
RETURNS TABLE (
  id               UUID,
  message_id       TEXT,
  subject          TEXT,
  author_name      TEXT,
  author_email     TEXT,
  date             TIMESTAMPTZ,
  body_new_content TEXT,
  source_url       TEXT,
  thread_root_id   TEXT,
  thread_depth     INTEGER,
  has_patch        BOOLEAN,
  patch_version    TEXT,
  rank             FLOAT
)
LANGUAGE SQL STABLE
AS $$
  SELECT
    e.id,
    e.message_id,
    e.subject,
    e.author_name,
    e.author_email,
    e.date,
    e.body_new_content,
    e.source_url,
    e.thread_root_id,
    e.thread_depth,
    e.has_patch,
    e.patch_version,
    ts_rank(
      to_tsvector('english', COALESCE(e.subject,'') || ' ' || COALESCE(e.body_new_content,'')),
      plainto_tsquery('english', search_query)
    ) AS rank
  FROM emails e
  WHERE
    to_tsvector('english', COALESCE(e.subject,'') || ' ' || COALESCE(e.body_new_content,''))
      @@ plainto_tsquery('english', search_query)
    AND (filter_date_from IS NULL OR e.date >= filter_date_from)
    AND (filter_date_to   IS NULL OR e.date <= filter_date_to)
    AND (filter_author    IS NULL OR e.author_name ILIKE '%' || filter_author || '%')
  ORDER BY rank DESC
  LIMIT match_count
  OFFSET offset_val;
$$;

-- Count for pagination
CREATE OR REPLACE FUNCTION count_emails_fts(
  search_query     TEXT,
  filter_date_from TIMESTAMPTZ DEFAULT NULL,
  filter_date_to   TIMESTAMPTZ DEFAULT NULL,
  filter_author    TEXT        DEFAULT NULL
)
RETURNS BIGINT
LANGUAGE SQL STABLE
AS $$
  SELECT COUNT(*)
  FROM emails e
  WHERE
    to_tsvector('english', COALESCE(e.subject,'') || ' ' || COALESCE(e.body_new_content,''))
      @@ plainto_tsquery('english', search_query)
    AND (filter_date_from IS NULL OR e.date >= filter_date_from)
    AND (filter_date_to   IS NULL OR e.date <= filter_date_to)
    AND (filter_author    IS NULL OR e.author_name ILIKE '%' || filter_author || '%');
$$;

-- Upsert thread stats — called by ingest.py after each batch
CREATE OR REPLACE FUNCTION upsert_thread_stats(root_id TEXT)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  v_subject         TEXT;
  v_participant_cnt INTEGER;
  v_message_cnt     INTEGER;
  v_date_start      TIMESTAMPTZ;
  v_date_end        TIMESTAMPTZ;
  v_has_patches     BOOLEAN;
  v_patch_cnt       INTEGER;
BEGIN
  SELECT
    (ARRAY_AGG(subject ORDER BY date ASC))[1],
    COUNT(DISTINCT author_name),
    COUNT(*),
    MIN(date),
    MAX(date),
    BOOL_OR(has_patch),
    COUNT(*) FILTER (WHERE has_patch = TRUE)
  INTO v_subject, v_participant_cnt, v_message_cnt,
       v_date_start, v_date_end, v_has_patches, v_patch_cnt
  FROM emails
  WHERE thread_root_id = root_id;

  INSERT INTO threads (
    root_message_id, subject, participant_count, message_count,
    date_start, date_end, has_patches, patch_count, updated_at
  )
  VALUES (
    root_id, v_subject, v_participant_cnt, v_message_cnt,
    v_date_start, v_date_end,
    COALESCE(v_has_patches, FALSE), COALESCE(v_patch_cnt, 0), NOW()
  )
  ON CONFLICT (root_message_id) DO UPDATE SET
    subject           = EXCLUDED.subject,
    participant_count = EXCLUDED.participant_count,
    message_count     = EXCLUDED.message_count,
    date_start        = EXCLUDED.date_start,
    date_end          = EXCLUDED.date_end,
    has_patches       = EXCLUDED.has_patches,
    patch_count       = EXCLUDED.patch_count,
    updated_at        = NOW();
END;
$$;
