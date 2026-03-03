export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getDb, Email } from "@/lib/db";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const sql = getDb();

    const [emailRows, childRows] = await Promise.all([
      sql`SELECT * FROM emails WHERE message_id = ${id} LIMIT 1`,
      sql`SELECT * FROM emails WHERE in_reply_to = ${id} ORDER BY date ASC`,
    ]);

    if (!emailRows.length) {
      return NextResponse.json({ error: "Email not found" }, { status: 404 });
    }

    const email = emailRows[0] as unknown as Email;
    const children = childRows as unknown as Email[];

    // Fetch parent if exists
    let parent: Email | null = null;
    if (email.in_reply_to) {
      const parentRows = await sql`
        SELECT * FROM emails WHERE message_id = ${email.in_reply_to} LIMIT 1
      `;
      if (parentRows.length) parent = parentRows[0] as unknown as Email;
    }

    return NextResponse.json({ email, parent, children });
  } catch (err) {
    console.error("[API /emails/[id]] Unexpected error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
