export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { checkAskRateLimit } from "@/lib/ratelimit";
import { askQuestion } from "@/lib/rag";

const bodySchema = z.object({
  question: z.string().min(3).max(1000),
  filters: z
    .object({
      date_from: z.string().optional(),
      date_to: z.string().optional(),
      author: z.string().optional(),
    })
    .optional()
    .default({}),
});

export async function POST(req: NextRequest) {
  try {
    // Rate limiting: 10 requests per minute per IP
    const rateLimitResult = await checkAskRateLimit(req);
    if (!rateLimitResult.success) {
      return NextResponse.json(
        {
          error: "Rate limit exceeded. Please wait a minute before asking again.",
          retry_after: Math.ceil((rateLimitResult.reset - Date.now()) / 1000),
        },
        {
          status: 429,
          headers: {
            "X-RateLimit-Limit": String(rateLimitResult.limit),
            "X-RateLimit-Remaining": String(rateLimitResult.remaining),
            "X-RateLimit-Reset": String(rateLimitResult.reset),
          },
        }
      );
    }

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

    const { question, filters } = parsed.data;

    // Run RAG pipeline
    const result = await askQuestion(question, filters);

    return NextResponse.json(result, {
      headers: {
        "X-RateLimit-Limit": String(rateLimitResult.limit),
        "X-RateLimit-Remaining": String(rateLimitResult.remaining),
      },
    });
  } catch (err) {
    console.error("[API /ask] Unexpected error:", err);
    return NextResponse.json(
      { error: "Failed to generate answer. Please try again." },
      { status: 500 }
    );
  }
}
