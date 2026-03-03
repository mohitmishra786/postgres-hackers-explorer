import { neon, neonConfig, NeonQueryFunction } from "@neondatabase/serverless";

// ============================================================
// Neon serverless connection — lazy singleton
// Uses HTTP for stateless serverless/edge, not a persistent pool.
// ============================================================

// fetchConnectionCache is always true in @neondatabase/serverless >=1.x (no-op, kept for clarity)

let _sql: NeonQueryFunction<false, false> | null = null;

/**
 * Returns the Neon tagged-template sql client.
 * Safe to call in every API route — the underlying connection is cached.
 */
export function getDb(): NeonQueryFunction<false, false> {
  if (!_sql) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("Missing DATABASE_URL environment variable");
    _sql = neon(url);
  }
  return _sql;
}

// ============================================================
// Database type definitions
// ============================================================

export interface Email {
  id: string;
  message_id: string;
  in_reply_to: string | null;
  references_ids: string[];
  subject: string;
  author_name: string | null;
  author_email: string | null;
  date: string; // ISO string from DB
  body_clean: string | null;
  body_new_content: string | null;
  source_url: string | null;
  month_period: string | null;
  thread_root_id: string | null;
  thread_depth: number;
  has_patch: boolean;
  patch_version: string | null;
  git_commit_refs: string[] | null;
  created_at: string;
}

export interface EmailWithSimilarity extends Email {
  similarity?: number;
  rank?: number;
}

export interface EmailNode extends Email {
  children: EmailNode[];
}

export interface Thread {
  id: string;
  root_message_id: string;
  subject: string;
  participant_count: number;
  message_count: number;
  date_start: string | null;
  date_end: string | null;
  summary: string | null;
  tags: string[] | null;
  has_patches: boolean;
  patch_count: number;
  commitfest_status: string | null;
  commitfest_id: string | null;
  commitfest_url: string | null;
  pg_version_target: string | null;
  is_committed: boolean;
  commit_hash: string | null;
  commit_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface Author {
  id: string;
  name: string;
  email_obfuscated: string | null;
  email_count: number;
  patch_count: number;
  review_count: number;
  first_seen: string | null;
  last_seen: string | null;
  topic_tags: string[] | null;
  company: string | null;
}

export interface Patch {
  id: string;
  thread_root_id: string;
  message_id: string;
  version: string | null;
  filename: string | null;
  content: string | null;
  diff_stats: {
    lines_added: number;
    lines_removed: number;
    files_changed: number;
  } | null;
  submitted_at: string | null;
  author_name: string | null;
}

export interface SearchFilters {
  date_from?: string;
  date_to?: string;
  author?: string;
}

export interface SourceEmail {
  message_id: string;
  subject: string;
  author_name: string | null;
  date: string;
  excerpt: string;
  source_url: string | null;
  thread_root_id: string | null;
  relevance_score: number;
}

export interface AskResponse {
  answer: string;
  sources: SourceEmail[];
  thread_ids: string[];
  query_id: string;
}

export interface StatsResponse {
  total_emails: number;
  total_threads: number;
  total_authors: number;
  total_patches: number;
  date_start: string | null;
  date_end: string | null;
  last_updated: string | null;
}
