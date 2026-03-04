export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getDb, Thread } from "@/lib/db";
import { cacheGet, cacheSet } from "@/lib/ratelimit";

const MAX_PER_PAGE = 50;

const querySchema = z.object({
  page: z.coerce.number().int().positive().max(100).default(1),
  per_page: z.coerce.number().int().min(1).max(MAX_PER_PAGE).default(25),
  status: z.string().max(50).optional(),
});

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const parsed = querySchema.safeParse({
      page: searchParams.get("page") ?? undefined,
      per_page: searchParams.get("per_page") ?? undefined,
      status: searchParams.get("status") ?? undefined,
    });

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid parameters", details: parsed.error.issues },
        { status: 400 }
      );
    }

    const { page, per_page, status } = parsed.data;
    const offset = (page - 1) * per_page;

    const cacheKey = `pghackers:commitfest:${page}:${per_page}:${status ?? ""}`;
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

    const statusClause = status
      ? sql`AND commitfest_status = ${status}`
      : sql``;

    const [rows, countRows] = await Promise.all([
      sql`
        SELECT
          id, root_message_id, subject, participant_count, message_count,
          date_start, date_end, has_patches, patch_count,
          commitfest_status, commitfest_id, commitfest_url,
          is_committed, pg_version_target, updated_at
        FROM threads
        WHERE commitfest_id IS NOT NULL ${statusClause}
        ORDER BY date_end DESC NULLS LAST
        LIMIT ${per_page} OFFSET ${offset}
      `,
      sql`
        SELECT COUNT(*)::int AS total
        FROM threads
        WHERE commitfest_id IS NOT NULL ${statusClause}
      `,
    ]);

    const threads = rows as unknown as Thread[];
    const total = (countRows[0] as { total: number })?.total ?? 0;

    // Cache 5 minutes — commitfest status can change
    await cacheSet(cacheKey, { threads, total }, 7200);

    return NextResponse.json({
      threads,
      total,
      page,
      per_page,
      total_pages: Math.ceil(total / per_page),
    });
  } catch (err) {
    console.error("[API /commitfest] Unexpected error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
