export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { generateEmbedding } from "@/lib/embeddings";
import { getDb } from "@/lib/db";
import { cacheGet, cacheSet } from "@/lib/ratelimit";

// Semantic search is always a top-K operation — no deep pagination needed.
// The model returns the top matches by cosine similarity; anything beyond
// page 3 is well below the relevance threshold and not useful.
const MAX_PER_PAGE = 20;
const MAX_PAGE = 3;

const bodySchema = z.object({
  query: z.string().min(1).max(500),
  page: z.coerce.number().int().positive().max(MAX_PAGE).default(1),
  per_page: z.coerce.number().int().min(1).max(MAX_PER_PAGE).default(20),
  filters: z
    .object({
      date_from: z.string().optional(),
      date_to: z.string().optional(),
      author: z.string().max(100).optional(),
    })
    .optional()
    .default({}),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    if (!body) {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request body", details: parsed.error.issues },
        { status: 400 }
      );
    }

    const { query, page, per_page, filters } = parsed.data;
    const offset = (page - 1) * per_page;
    // Fetch enough results upfront to support pagination without re-embedding
    const fetchLimit = MAX_PAGE * MAX_PER_PAGE; // 60 max

    // Cache by query + filters (embedding is deterministic for same text)
    const cacheKey = `pghackers:sem:${query}:${per_page}:${filters.date_from ?? ""}:${filters.date_to ?? ""}:${filters.author ?? ""}`;
    const cached = await cacheGet<{ all_results: unknown[] }>(cacheKey);

    let allResults: unknown[];

    if (cached) {
      allResults = cached.all_results;
    } else {
      const embedding = await generateEmbedding(query);
      const embeddingLiteral = `[${embedding.join(",")}]`;
      const sql = getDb();

      const rows = await sql`
        SELECT
          id, message_id, subject, author_name, author_email, date,
          source_url, thread_root_id, thread_depth, has_patch, patch_version,
          1 - (embedding <=> ${embeddingLiteral}::vector) AS similarity
        FROM emails
        WHERE
          embedding IS NOT NULL
          AND 1 - (embedding <=> ${embeddingLiteral}::vector) > 0.25
          AND (${filters.date_from ?? null}::timestamptz IS NULL OR date >= ${filters.date_from ?? null}::timestamptz)
          AND (${filters.date_to ?? null}::timestamptz IS NULL OR date <= ${filters.date_to ?? null}::timestamptz)
          AND (${filters.author ?? null} IS NULL OR author_name ILIKE ${"%" + (filters.author ?? "") + "%"})
        ORDER BY embedding <=> ${embeddingLiteral}::vector
        LIMIT ${fetchLimit}
      `;

      allResults = rows;
      // Cache the full result set for 30 minutes — same query = same embedding = same results
      await cacheSet(cacheKey, { all_results: allResults }, 1800);
    }

    const total = allResults.length;
    const results = allResults.slice(offset, offset + per_page);

    return NextResponse.json({
      results,
      total,
      query,
      page,
      per_page,
      total_pages: Math.ceil(total / per_page),
    });
  } catch (err) {
    console.error("[API /search/semantic] Unexpected error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
