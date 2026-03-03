export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { cacheGet, cacheSet } from "@/lib/ratelimit";

const MAX_PER_PAGE = 20;
// Deep OFFSET on a FTS query is a full re-scan every time.
// Cap at 1000 rows (50 pages × 20) — beyond this, users should refine filters.
const MAX_OFFSET = 1_000;

const querySchema = z.object({
  q: z.string().min(1).max(500),
  page: z.coerce.number().int().positive().max(100).default(1),
  per_page: z.coerce.number().int().min(1).max(MAX_PER_PAGE).default(20),
  date_from: z.string().optional(),
  date_to: z.string().optional(),
  author: z.string().max(100).optional(),
});

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const parsed = querySchema.safeParse({
      q: searchParams.get("q"),
      page: searchParams.get("page") ?? undefined,
      per_page: searchParams.get("per_page") ?? undefined,
      date_from: searchParams.get("date_from") ?? undefined,
      date_to: searchParams.get("date_to") ?? undefined,
      author: searchParams.get("author") ?? undefined,
    });

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid query parameters", details: parsed.error.issues },
        { status: 400 }
      );
    }

    const { q, page, per_page, date_from, date_to, author } = parsed.data;
    const offset = (page - 1) * per_page;

    if (offset > MAX_OFFSET) {
      return NextResponse.json(
        { error: "Page too deep. Add date or author filters to narrow results." },
        { status: 400 }
      );
    }

    const cacheKey = `pghackers:kw:${q}:${page}:${per_page}:${date_from ?? ""}:${date_to ?? ""}:${author ?? ""}`;
    const cached = await cacheGet<{ results: unknown[]; total: number }>(cacheKey);
    if (cached) {
      return NextResponse.json({
        results: cached.results,
        total: cached.total,
        query: q,
        page,
        per_page,
        total_pages: Math.ceil(cached.total / per_page),
      });
    }

    const sql = getDb();

    // Run data fetch and count in parallel
    const [rows, countRows] = await Promise.all([
      sql`
        SELECT
          id, message_id, subject, author_name, author_email, date,
          source_url, thread_root_id, thread_depth, has_patch, patch_version,
          ts_rank(
            to_tsvector('english', coalesce(subject,'') || ' ' || coalesce(body_new_content,'')),
            plainto_tsquery('english', ${q})
          ) AS rank
        FROM emails
        WHERE
          to_tsvector('english', coalesce(subject,'') || ' ' || coalesce(body_new_content,''))
            @@ plainto_tsquery('english', ${q})
          AND (${date_from ?? null}::timestamptz IS NULL OR date >= ${date_from ?? null}::timestamptz)
          AND (${date_to ?? null}::timestamptz IS NULL OR date <= ${date_to ?? null}::timestamptz)
          AND (${author ?? null} IS NULL OR author_name ILIKE ${"%" + (author ?? "") + "%"})
        ORDER BY rank DESC
        LIMIT ${per_page} OFFSET ${offset}
      `,
      sql`
        SELECT COUNT(*)::int AS total
        FROM emails
        WHERE
          to_tsvector('english', coalesce(subject,'') || ' ' || coalesce(body_new_content,''))
            @@ plainto_tsquery('english', ${q})
          AND (${date_from ?? null}::timestamptz IS NULL OR date >= ${date_from ?? null}::timestamptz)
          AND (${date_to ?? null}::timestamptz IS NULL OR date <= ${date_to ?? null}::timestamptz)
          AND (${author ?? null} IS NULL OR author_name ILIKE ${"%" + (author ?? "") + "%"})
      `,
    ]);

    const total = (countRows[0] as { total: number })?.total ?? 0;

    // Cache 1 hour — keyword results over historical data are stable
    await cacheSet(cacheKey, { results: rows, total }, 3600);

    return NextResponse.json({
      results: rows,
      total,
      query: q,
      page,
      per_page,
      total_pages: Math.ceil(total / per_page),
    });
  } catch (err) {
    console.error("[API /search/keyword] Unexpected error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
