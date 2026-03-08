"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Thread } from "@/lib/db";
import { formatDateRange, getThreadBadge } from "@/lib/utils";
import { RetroSpinner } from "@/components/RetroLoader";

export default function PatchesPage() {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);

  const fetchPatches = async (p: number) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/patches?page=${p}&per_page=30`);
      const data = await res.json();
      setThreads(data.threads ?? []);
      setTotal(data.total ?? 0);
      setPage(p);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPatches(1);
  }, []);

  const totalPages = Math.ceil(total / 30);

  return (
    <div className="p-6 max-w-5xl">
      {/* Header */}
      <div className="mb-6">
        <div className="text-[#004d14] text-[11px] mb-1">// PATCH_DASHBOARD</div>
        <h1 className="text-2xl font-bold text-[#00ff41]">
          patches
          <span className="text-[#004d14] ml-2 text-base font-normal">
            ({total.toLocaleString()} threads with patches)
          </span>
        </h1>
      </div>

      {/* Stats bar */}
      <div className="retro-card p-3 mb-6 font-mono text-[12px] flex flex-wrap gap-4">
        <span>
          total:{" "}
          <span className="text-[#00ff41]">{total.toLocaleString()}</span>
        </span>
      </div>

      {/* Patch thread list */}
      {loading ? (
        <RetroSpinner label="loading patches" />
      ) : (
        <div className="space-y-2">
          {threads.map((thread) => {
            const badge = getThreadBadge(thread);
            return (
              <Link
                key={thread.id}
                href={`/threads/${encodeURIComponent(thread.root_message_id)}`}
                className="block retro-card p-3 hover:retro-card-active"
              >
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="flex-1 min-w-0">
                    <div className="text-[#00ff41] font-bold text-sm truncate">
                      {thread.subject}
                    </div>
                  </div>
                  <span
                    className={`
                      text-[10px] font-mono px-1 py-0.5 border whitespace-nowrap flex-shrink-0
                      ${badge.variant === "committed" ? "badge-committed" : ""}
                      ${badge.variant === "in_review" ? "badge-in-review" : ""}
                      ${badge.variant === "patch" ? "badge-patch" : ""}
                      ${badge.variant === "discussion" ? "badge-discussion" : ""}
                    `}
                  >
                    {badge.label}
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-3 text-[11px] text-[#004d14]">
                  <span>
                    patches:{" "}
                    <span className="text-[#00cc33]">{thread.patch_count}</span>
                  </span>
                  <span>
                    messages:{" "}
                    <span className="text-[#00cc33]">{thread.message_count}</span>
                  </span>
                  {thread.pg_version_target && (
                    <span>→ PG {thread.pg_version_target}</span>
                  )}
                  {thread.commitfest_id && (
                    <span className="text-[#ffaa00]">CF#{thread.commitfest_id}</span>
                  )}
                  <span className="ml-auto">
                    {formatDateRange(thread.date_start, thread.date_end)}
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center gap-2 mt-6 justify-center">
          <button
            onClick={() => fetchPatches(page - 1)}
            disabled={page <= 1}
            className="retro-btn text-[11px] disabled:opacity-30"
          >
            [prev]
          </button>
          <span className="text-[#004d14] text-[11px] font-mono">
            {page} / {totalPages}
          </span>
          <button
            onClick={() => fetchPatches(page + 1)}
            disabled={page >= totalPages}
            className="retro-btn text-[11px] disabled:opacity-30"
          >
            [next]
          </button>
        </div>
      )}
    </div>
  );
}
