export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { cacheGet, cacheSet } from "@/lib/ratelimit";

const MAX_PER_PAGE = 20;
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

    const cacheKey = `pghackers:kw2:${q}:${page}:${per_page}:${date_from ?? ""}:${date_to ?? ""}:${author ?? ""}`;
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

    // Use sql.query(string, params[]) to build dynamic WHERE clauses.
    // The tagged-template form passes all interpolated values as typed parameters,
    // but Postgres cannot infer the type of bare null params (error 42P18).
    // sql.query() with explicit $N placeholders and a params array avoids this.
    const params: unknown[] = [q];
    const extraClauses: string[] = [];

    if (date_from) { params.push(date_from); extraClauses.push(`date >= $${params.length}::timestamptz`); }
    if (date_to)   { params.push(date_to);   extraClauses.push(`date <= $${params.length}::timestamptz`); }
    if (author)    { params.push(`%${author}%`); extraClauses.push(`author_name ILIKE $${params.length}`); }

    const whereExtra = extraClauses.length > 0 ? " AND " + extraClauses.join(" AND ") : "";

    const tsvec = `to_tsvector('english', coalesce(subject,'') || ' ' || coalesce(body_new_content,''))`;
    const tsq   = `websearch_to_tsquery('english', $1)`;

    const [rows, countRows] = await Promise.all([
      sql.query(
        `SELECT id, message_id, subject, author_name, author_email, date,
                body_new_content, source_url, thread_root_id, thread_depth,
                has_patch, patch_version,
                ts_rank(${tsvec}, ${tsq}) AS rank
         FROM emails
         WHERE ${tsvec} @@ ${tsq}${whereExtra}
         ORDER BY rank DESC
         LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, per_page, offset]
      ),
      sql.query(
        `SELECT COUNT(*)::int AS total FROM emails
         WHERE ${tsvec} @@ ${tsq}${whereExtra}`,
        params
      ),
    ]);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const total = (countRows as any[])[0]?.total ?? 0;

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
