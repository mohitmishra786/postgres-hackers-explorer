export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getDb, Email, EmailNode, Thread } from "@/lib/db";
import { buildThreadTree } from "@/lib/utils";

const MAX_PER_PAGE = 100;
const HARD_CAP = 500; // absolute ceiling regardless of page

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const sql = getDb();

    // Pagination params
    const { searchParams } = new URL(req.url);
    const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10));
    const perPage = Math.min(
      MAX_PER_PAGE,
      Math.max(1, parseInt(searchParams.get("per_page") ?? "100", 10))
    );
    const offset = Math.min((page - 1) * perPage, HARD_CAP - perPage);

    const [threadRows, countRows, emailRows] = await Promise.all([
      sql`SELECT * FROM threads WHERE root_message_id = ${id} LIMIT 1`,
      sql`SELECT COUNT(*)::int AS total FROM emails WHERE thread_root_id = ${id}`,
      sql`
        SELECT
          id, message_id, in_reply_to, references_ids, subject,
          author_name, author_email, date, body_clean, body_new_content,
          source_url, month_period, thread_root_id, thread_depth,
          has_patch, patch_version, git_commit_refs, created_at
        FROM emails
        WHERE thread_root_id = ${id}
        ORDER BY date ASC
        LIMIT ${perPage}
        OFFSET ${offset}
      `,
    ]);

    if (!threadRows.length) {
      return NextResponse.json({ error: "Thread not found" }, { status: 404 });
    }

    const thread = threadRows[0] as unknown as Thread;
    const total: number = (countRows[0] as { total: number }).total;
    const emails = emailRows as unknown as Email[];

    // Tree is only accurate when all emails are fetched (page 1 with full count).
    // For paginated views the client rebuilds the tree from the slice.
    const tree = buildThreadTree(emails) as EmailNode[];

    const totalPages = Math.ceil(Math.min(total, HARD_CAP) / perPage);

    return NextResponse.json({
      thread,
      emails,
      tree,
      pagination: { page, per_page: perPage, total, total_pages: totalPages },
    });
  } catch (err) {
    console.error("[API /threads/[id]] Unexpected error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
