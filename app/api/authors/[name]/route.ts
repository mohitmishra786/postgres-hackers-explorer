export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { cacheGet, cacheSet } from "@/lib/ratelimit";

interface AuthorProfileThread {
  root_message_id: string;
  subject: string;
  date_start: string | null;
  date_end: string | null;
  message_count: number;
  has_patches: boolean;
}

interface AuthorProfileEmail {
  message_id: string;
  subject: string;
  date: string;
  thread_root_id: string | null;
  has_patch: boolean;
  patch_version: string | null;
  source_url: string | null;
  body_new_content: string | null;
}

interface AuthorProfile {
  name: string;
  email_obfuscated: string | null;
  email_count: number;
  patch_count: number;
  review_count: number;
  first_seen: string | null;
  last_seen: string | null;
  topic_tags: string[] | null;
  threads: AuthorProfileThread[];
  recent_emails: AuthorProfileEmail[];
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  try {
    const { name } = await params;
    const authorName = decodeURIComponent(name);

    const cacheKey = `pghackers:author:${authorName}`;
    const cached = await cacheGet<AuthorProfile>(cacheKey);
    if (cached) {
      return NextResponse.json(cached);
    }

    const sql = getDb();

    // 1. Fetch author row
    const authorRows = await sql`
      SELECT
        id, name, email_obfuscated, email_count, patch_count, review_count,
        first_seen, last_seen, topic_tags
      FROM authors
      WHERE name = ${authorName}
      LIMIT 1
    `;

    if (authorRows.length === 0) {
      return NextResponse.json({ error: "Author not found" }, { status: 404 });
    }

    const author = authorRows[0] as {
      id: string;
      name: string;
      email_obfuscated: string | null;
      email_count: number;
      patch_count: number;
      review_count: number;
      first_seen: string | null;
      last_seen: string | null;
      topic_tags: string[] | null;
    };

    // 2. Fetch threads this author participated in (via emails)
    const threadRows = await sql`
      SELECT DISTINCT ON (t.root_message_id)
        t.root_message_id, t.subject, t.date_start, t.date_end,
        t.message_count, t.has_patches
      FROM threads t
      INNER JOIN emails e ON e.thread_root_id = t.root_message_id
      WHERE e.author_name = ${authorName}
      ORDER BY t.root_message_id, t.date_start DESC NULLS LAST
      LIMIT 30
    ` as unknown as AuthorProfileThread[];

    // Sort threads by date descending after dedup
    const threads = [...threadRows].sort((a, b) => {
      const da = a.date_start ? new Date(a.date_start).getTime() : 0;
      const db = b.date_start ? new Date(b.date_start).getTime() : 0;
      return db - da;
    });

    // 3. Fetch recent emails by this author (latest 20 patches or emails)
    const emailRows = await sql`
      SELECT
        message_id, subject, date, thread_root_id,
        has_patch, patch_version, source_url,
        left(body_new_content, 300) AS body_new_content
      FROM emails
      WHERE author_name = ${authorName}
      ORDER BY date DESC
      LIMIT 20
    ` as unknown as AuthorProfileEmail[];

    const profile: AuthorProfile = {
      name: author.name,
      email_obfuscated: author.email_obfuscated,
      email_count: author.email_count,
      patch_count: author.patch_count,
      review_count: author.review_count,
      first_seen: author.first_seen,
      last_seen: author.last_seen,
      topic_tags: author.topic_tags,
      threads,
      recent_emails: emailRows,
    };

    // Cache for 5 minutes
    await cacheSet(cacheKey, profile, 7200);

    return NextResponse.json(profile);
  } catch (err) {
    console.error("[API /authors/[name]] Unexpected error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
