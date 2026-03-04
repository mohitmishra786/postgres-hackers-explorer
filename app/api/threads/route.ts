export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getDb, Thread } from "@/lib/db";
import { cacheGet, cacheSet } from "@/lib/ratelimit";

// Hard limits — prevent deep scans and oversized payloads
const MAX_PER_PAGE = 50;
const MAX_OFFSET = 10_000; // refuse to scan beyond row 10 000

const querySchema = z.object({
  page: z.coerce.number().int().positive().max(500).default(1),
  per_page: z.coerce.number().int().min(1).max(MAX_PER_PAGE).default(25),
  sort: z.enum(["recent", "active", "patches", "committed"]).default("recent"),
  filter: z.enum(["has_patches", "committed", "in_review", ""]).optional(),
  search: z.string().max(200).optional(),
});

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const parsed = querySchema.safeParse({
      page: searchParams.get("page") ?? undefined,
      per_page: searchParams.get("per_page") ?? undefined,
      sort: searchParams.get("sort") ?? undefined,
      filter: searchParams.get("filter") ?? undefined,
      search: searchParams.get("search") ?? undefined,
    });

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid parameters", details: parsed.error.issues },
        { status: 400 }
      );
    }

    const { page, per_page, sort, filter, search } = parsed.data;
    const offset = (page - 1) * per_page;

    if (offset > MAX_OFFSET) {
      return NextResponse.json(
        { error: "Page too deep. Use date filters to narrow results instead." },
        { status: 400 }
      );
    }

    const cacheKey = `pghackers:threads:${page}:${per_page}:${sort}:${filter ?? ""}:${search ?? ""}`;
    const cached = await cacheGet<{ threads: Thread[]; total: number }>(cacheKey);
    if (cached) {
      return NextResponse.json({
        threads: cached.threads,
        total: cached.total,
        page,
        per_page,
        total_pages: Math.ceil(cached.total / per_page),
      });
    }

    const sql = getDb();

    const filterClause =
      filter === "has_patches"
        ? sql`AND has_patches = true`
        : filter === "committed"
        ? sql`AND is_committed = true`
        : filter === "in_review"
        ? sql`AND commitfest_status = 'Needs Review'`
        : sql``;

    const searchClause = search
      ? sql`AND subject ILIKE ${"%" + search + "%"}`
      : sql``;

    const orderClause =
      sort === "active"
        ? sql`ORDER BY date_end DESC NULLS LAST`
        : sort === "patches"
        ? sql`ORDER BY patch_count DESC`
        : sort === "committed"
        ? sql`ORDER BY date_end DESC NULLS LAST`
        : sql`ORDER BY date_start DESC NULLS LAST`;

    const [rows, countRows] = await Promise.all([
      sql`
        SELECT
          id, root_message_id, subject, participant_count, message_count,
          date_start, date_end, has_patches, patch_count,
          commitfest_status, is_committed, summary, tags,
          pg_version_target, updated_at
        FROM threads
        WHERE true ${filterClause} ${searchClause}
        ${orderClause}
        LIMIT ${per_page} OFFSET ${offset}
      `,
      sql`
        SELECT COUNT(*)::int AS total FROM threads
        WHERE true ${filterClause} ${searchClause}
      `,
    ]);

    const threads = rows as unknown as Thread[];
    const total = (countRows[0] as { total: number })?.total ?? 0;

    await cacheSet(cacheKey, { threads, total }, 7200);

    return NextResponse.json({
      threads,
      total,
      page,
      per_page,
      total_pages: Math.ceil(total / per_page),
    });
  } catch (err) {
    console.error("[API /threads] Unexpected error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
