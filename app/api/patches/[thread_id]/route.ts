export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getDb, Patch } from "@/lib/db";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ thread_id: string }> }
) {
  try {
    const { thread_id } = await params;
    const sql = getDb();

    const rows = await sql`
      SELECT * FROM patches
      WHERE thread_root_id = ${thread_id}
      ORDER BY submitted_at DESC NULLS LAST
    `;

    return NextResponse.json({ patches: rows as unknown as Patch[] });
  } catch (err) {
    console.error("[API /patches/[thread_id]] Unexpected error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
