export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { generateEmbedding } from "@/lib/embeddings";
import { getDb } from "@/lib/db";
import { cacheGet, cacheSet } from "@/lib/ratelimit";

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
    const { date_from, date_to, author } = filters;
    const offset = (page - 1) * per_page;
    const fetchLimit = MAX_PAGE * MAX_PER_PAGE; // 60 max

    const cacheKey = `pghackers:sem2:${query}:${per_page}:${date_from ?? ""}:${date_to ?? ""}:${author ?? ""}`;
    const cached = await cacheGet<{ all_results: unknown[] }>(cacheKey);

    let allResults: unknown[];

    if (cached) {
      allResults = cached.all_results;
    } else {
      const embedding = await generateEmbedding(query);

      if (!embedding || embedding.length === 0) {
        console.error("[API /search/semantic] Empty embedding returned from HuggingFace");
        return NextResponse.json({ error: "Embedding service unavailable" }, { status: 503 });
      }

      const embeddingLiteral = `[${embedding.join(",")}]`;
      const sql = getDb();

      // Use sql.query() with explicit $N params to avoid Postgres error 42P18
      // (cannot determine data type of bare null parameter in tagged-template form).
      const params: unknown[] = [embeddingLiteral, fetchLimit];
      const extraClauses: string[] = [];

      if (date_from) { params.push(date_from); extraClauses.push(`date >= $${params.length}::timestamptz`); }
      if (date_to)   { params.push(date_to);   extraClauses.push(`date <= $${params.length}::timestamptz`); }
      if (author)    { params.push(`%${author}%`); extraClauses.push(`author_name ILIKE $${params.length}`); }

      const whereExtra = extraClauses.length > 0 ? " AND " + extraClauses.join(" AND ") : "";

      const rows = await sql.query(
        `SELECT id, message_id, subject, author_name, author_email, date,
                source_url, thread_root_id, thread_depth, has_patch, patch_version,
                1 - (embedding <=> $1::vector) AS similarity
         FROM emails
         WHERE embedding IS NOT NULL
           AND 1 - (embedding <=> $1::vector) > 0.1${whereExtra}
         ORDER BY embedding <=> $1::vector
         LIMIT $2`,
        params
      );

      allResults = rows;
      await cacheSet(cacheKey, { all_results: allResults }, 1800);
    }

    const total = allResults.length;
    const results = (allResults as unknown[]).slice(offset, offset + per_page);

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
