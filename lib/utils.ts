import { format, formatDistanceToNow } from "date-fns";
import { Email, EmailNode } from "./db";

// ============================================================
// Date formatting
// ============================================================

export function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "Unknown date";
  try {
    return format(new Date(dateStr), "d MMM yyyy, HH:mm 'UTC'");
  } catch {
    return dateStr;
  }
}

export function formatDateShort(dateStr: string | null | undefined): string {
  if (!dateStr) return "";
  try {
    return format(new Date(dateStr), "d MMM yyyy");
  } catch {
    return dateStr;
  }
}

export function formatRelativeDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "";
  try {
    return formatDistanceToNow(new Date(dateStr), { addSuffix: true });
  } catch {
    return dateStr;
  }
}

export function formatDateRange(
  start: string | null | undefined,
  end: string | null | undefined
): string {
  if (!start) return "Unknown";
  const startStr = formatDateShort(start);
  if (!end || start === end) return startStr;
  return `${startStr} – ${formatDateShort(end)}`;
}

// ============================================================
// Text helpers
// ============================================================

export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + "...";
}

export function getExcerpt(email: Email, maxLength = 200): string {
  const body = email.body_new_content || email.body_clean || "";
  const cleaned = body.replace(/\n+/g, " ").replace(/\s+/g, " ").trim();
  return truncate(cleaned, maxLength);
}

// ============================================================
// Thread tree builder
// ============================================================

export function buildThreadTree(emails: Email[]): EmailNode[] {
  const byId = new Map<string, EmailNode>();
  const roots: EmailNode[] = [];

  for (const email of emails) {
    byId.set(email.message_id, { ...email, children: [] });
  }

  for (const email of emails) {
    const node = byId.get(email.message_id)!;
    const parentId = email.in_reply_to;
    if (parentId && byId.has(parentId)) {
      byId.get(parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  const sortChildren = (node: EmailNode): void => {
    node.children.sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
    );
    node.children.forEach(sortChildren);
  };

  roots.forEach(sortChildren);
  roots.sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
  );

  return roots;
}

// ============================================================
// Patch / diff helpers
// ============================================================

/**
 * Extract patch version from a subject line: [PATCH v3] → "v3"
 */
export function extractPatchVersion(subject: string): string | null {
  const match = subject.match(/\[PATCH(?:\s+v(\d+))?\]/i);
  if (!match) return null;
  return match[1] ? `v${match[1]}` : "v1";
}

/**
 * Format diff stats as "+N -N" string.
 */
export function formatDiffStats(stats: {
  lines_added: number;
  lines_removed: number;
} | null): string {
  if (!stats) return "";
  return `+${stats.lines_added.toLocaleString()} -${stats.lines_removed.toLocaleString()}`;
}

// ============================================================
// Commitfest status badge helpers
// ============================================================

export type BadgeVariant =
  | "committed"
  | "in_review"
  | "patch"
  | "discussion"
  | "waiting";

export function getThreadBadge(thread: {
  is_committed?: boolean;
  commitfest_status?: string | null;
  has_patches?: boolean;
}): { label: string; variant: BadgeVariant } {
  if (thread.is_committed)
    return { label: "[COMMITTED]", variant: "committed" };
  if (
    thread.commitfest_status === "Needs Review" ||
    thread.commitfest_status === "In Progress"
  )
    return { label: "[IN REVIEW]", variant: "in_review" };
  if (thread.has_patches)
    return { label: "[PATCH AVAILABLE]", variant: "patch" };
  return { label: "[DISCUSSION]", variant: "discussion" };
}

// ============================================================
// Color helpers (deterministic from name)
// ============================================================

export function getAuthorInitials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

// ============================================================
// URL helpers
// ============================================================

export function buildMailmanUrl(
  messageId: string,
  sourceUrl?: string | null
): string {
  if (sourceUrl) return sourceUrl;
  return `https://lists.postgresql.org/pgsql-hackers/`;
}

export function buildGitUrl(ref: string): string {
  if (ref.startsWith("http")) return ref;
  return `https://git.postgresql.org/gitweb/?p=postgresql.git;a=commit;h=${ref}`;
}
