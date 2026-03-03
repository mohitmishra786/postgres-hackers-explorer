export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getDb, Author } from "@/lib/db";
import { cacheGet, cacheSet } from "@/lib/ratelimit";

const MAX_PER_PAGE = 50;

const querySchema = z.object({
  page: z.coerce.number().int().positive().max(200).default(1),
  per_page: z.coerce.number().int().min(1).max(MAX_PER_PAGE).default(25),
  sort: z.enum(["emails", "patches", "reviews"]).default("emails"),
  search: z.string().max(100).optional(),
});

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const parsed = querySchema.safeParse({
      page: searchParams.get("page") ?? undefined,
      per_page: searchParams.get("per_page") ?? undefined,
      sort: searchParams.get("sort") ?? undefined,
      search: searchParams.get("search") ?? undefined,
    });

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid parameters", details: parsed.error.issues },
        { status: 400 }
      );
    }

    const { page, per_page, sort, search } = parsed.data;
    const offset = (page - 1) * per_page;

    const cacheKey = `pghackers:authors:${page}:${per_page}:${sort}:${search ?? ""}`;
    const cached = await cacheGet<{ authors: Author[]; total: number }>(cacheKey);
    if (cached) {
      return NextResponse.json({
        authors: cached.authors,
        total: cached.total,
        page,
        per_page,
        total_pages: Math.ceil(cached.total / per_page),
      });
    }

    const sql = getDb();

    const searchClause = search
      ? sql`AND name ILIKE ${"%" + search + "%"}`
      : sql``;

    const [rows, countRows] = await Promise.all([
      sort === "patches"
        ? sql`
            SELECT id, name, email_obfuscated, email_count, patch_count, review_count, first_seen, last_seen
            FROM authors WHERE true ${searchClause}
            ORDER BY patch_count DESC LIMIT ${per_page} OFFSET ${offset}
          `
        : sort === "reviews"
        ? sql`
            SELECT id, name, email_obfuscated, email_count, patch_count, review_count, first_seen, last_seen
            FROM authors WHERE true ${searchClause}
            ORDER BY review_count DESC LIMIT ${per_page} OFFSET ${offset}
          `
        : sql`
            SELECT id, name, email_obfuscated, email_count, patch_count, review_count, first_seen, last_seen
            FROM authors WHERE true ${searchClause}
            ORDER BY email_count DESC LIMIT ${per_page} OFFSET ${offset}
          `,
      sql`SELECT COUNT(*)::int AS total FROM authors WHERE true ${searchClause}`,
    ]);

    const authors = rows as unknown as Author[];
    const total = (countRows[0] as { total: number })?.total ?? 0;

    // Cache for 10 minutes — author stats update slowly
    await cacheSet(cacheKey, { authors, total }, 600);

    return NextResponse.json({
      authors,
      total,
      page,
      per_page,
      total_pages: Math.ceil(total / per_page),
    });
  } catch (err) {
    console.error("[API /authors] Unexpected error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
