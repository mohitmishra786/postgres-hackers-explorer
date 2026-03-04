export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { cacheGet, cacheSet } from "@/lib/ratelimit";

export async function GET() {
  try {
    const cacheKey = "pghackers:stats";
    const cached = await cacheGet<object>(cacheKey);
    if (cached) {
      return NextResponse.json(cached);
    }

    const sql = getDb();

    const [counts, dateRange, patchCount, syncTime] = await Promise.all([
      sql`
        SELECT
          (SELECT COUNT(*)::int FROM emails)  AS total_emails,
          (SELECT COUNT(*)::int FROM threads) AS total_threads,
          (SELECT COUNT(*)::int FROM authors) AS total_authors
      `,
      sql`
        SELECT
          MIN(date) AS date_start,
          MAX(date) AS date_end
        FROM emails
      `,
      sql`
        SELECT COALESCE(SUM(patch_count), 0)::int AS total_patches
        FROM threads
        WHERE has_patches = true
      `,
      // last_synced = when the most recently inserted/updated row landed in the DB
      sql`SELECT MAX(created_at) AS last_synced FROM emails`,
    ]);

    const stats = {
      total_emails: (counts[0] as { total_emails: number }).total_emails,
      total_threads: (counts[0] as { total_threads: number }).total_threads,
      total_authors: (counts[0] as { total_authors: number }).total_authors,
      total_patches: (patchCount[0] as { total_patches: number }).total_patches,
      date_start: (dateRange[0] as { date_start: string | null }).date_start,
      date_end: (dateRange[0] as { date_end: string | null }).date_end,
      // last_synced: when the newest row was written to Neon (ingest time)
      last_synced: (syncTime[0] as { last_synced: string | null }).last_synced,
    };

    // Cache 30 minutes — refreshes within half an hour of a new ingest
    await cacheSet(cacheKey, stats, 1800);
    return NextResponse.json(stats);
  } catch (err) {
    console.error("[API /stats] Unexpected error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
