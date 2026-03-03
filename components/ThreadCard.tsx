"use client";

import Link from "next/link";
import { Thread } from "@/lib/db";
import { formatDateRange, getThreadBadge, formatDiffStats } from "@/lib/utils";

interface ThreadCardProps {
  thread: Thread;
  active?: boolean;
  onClick?: () => void;
}

export default function ThreadCard({
  thread,
  active = false,
  onClick,
}: ThreadCardProps) {
  const badge = getThreadBadge(thread);

  return (
    <div
      className={`
        retro-card p-3 cursor-pointer select-none transition-all duration-100
        ${active ? "retro-card-active" : ""}
      `}
      onClick={onClick}
    >
      {/* Header row */}
      <div className="flex items-start justify-between gap-2 mb-1">
        <div className="flex-1 min-w-0">
          {/* Thread ID */}
          <div className="text-[10px] text-[#004d14] truncate mb-1">
            {thread.root_message_id.slice(0, 50)}
            {thread.root_message_id.length > 50 ? "..." : ""}
          </div>
          {/* Subject */}
          <Link
            href={`/threads/${encodeURIComponent(thread.root_message_id)}`}
            className="text-[#00ff41] font-bold text-sm leading-snug hover:underline line-clamp-2"
            onClick={(e) => {
              e.stopPropagation();
            }}
          >
            {thread.subject}
          </Link>
        </div>

        {/* Badge */}
        <div className="flex-shrink-0">
          <span
            className={`
              text-[10px] font-mono px-1 py-0.5 border whitespace-nowrap
              ${
                badge.variant === "committed"
                  ? "badge-committed"
                  : badge.variant === "in_review"
                  ? "badge-in-review"
                  : badge.variant === "patch"
                  ? "badge-patch"
                  : "badge-discussion"
              }
            `}
          >
            {badge.label}
          </span>
        </div>
      </div>

      {/* Meta row */}
      <div className="flex items-center gap-3 text-[11px] text-[#004d14] mt-2 flex-wrap">
        <span>
          participants:{" "}
          <span className="text-[#00cc33]">{thread.participant_count ?? 0}</span>
        </span>
        <span>
          messages:{" "}
          <span className="text-[#00cc33]">{thread.message_count ?? 0}</span>
        </span>
        {thread.has_patches && thread.patch_count > 0 && (
          <span className="text-[#00ffff]">
            patches: {thread.patch_count}
          </span>
        )}
        {thread.commitfest_id && (
          <span className="text-[#ffaa00]">
            CF#{thread.commitfest_id}
          </span>
        )}
        {thread.pg_version_target && (
          <span className="text-[#004d14]">→ PG {thread.pg_version_target}</span>
        )}
      </div>

      {/* Date + diff stats */}
      <div className="flex items-center justify-between mt-1 text-[10px] text-[#004d14]">
        <span>{formatDateRange(thread.date_start, thread.date_end)}</span>
        {thread.has_patches && (
          <span className="text-[11px] font-mono">
            <span className="text-[#00ff41]">+</span>
            <span className="text-[#ff4444]">-</span>
            {" "}patch available
          </span>
        )}
      </div>
    </div>
  );
}
