"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { Thread, Email, EmailNode } from "@/lib/db";
import { buildThreadTree, formatDate, formatDateRange, getThreadBadge } from "@/lib/utils";
import ThreadTree from "@/components/ThreadTree";
import PatchViewer from "@/components/PatchViewer";
import { RetroSpinner } from "@/components/RetroLoader";
import { Patch } from "@/lib/db";

interface Pagination {
  page: number;
  per_page: number;
  total: number;
  total_pages: number;
}

interface ThreadData {
  thread: Thread;
  emails: Email[];
  tree: EmailNode[];
  pagination?: Pagination;
}

export default function ThreadDetailPage() {
  const params = useParams();
  const id = decodeURIComponent(params.id as string);

  const [data, setData] = useState<ThreadData | null>(null);
  const [patches, setPatches] = useState<Patch[]>([]);
  const [loading, setLoading] = useState(true);
  const [emailPage, setEmailPage] = useState(1);
  const [activeTab, setActiveTab] = useState<"discussion" | "patches">("discussion");

  const fetchEmails = async (p: number, existingData: ThreadData) => {
    const res = await fetch(
      `/api/threads/${encodeURIComponent(id)}?page=${p}&per_page=100`
    );
    if (!res.ok) return;
    const json = await res.json();
    const tree = buildThreadTree(json.emails ?? []);
    setData({ ...existingData, emails: json.emails ?? [], tree, pagination: json.pagination });
    setEmailPage(p);
  };

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        const [threadRes, patchRes] = await Promise.all([
          fetch(`/api/threads/${encodeURIComponent(id)}?page=1&per_page=100`),
          fetch(`/api/patches/${encodeURIComponent(id)}`),
        ]);

        if (threadRes.ok) {
          const threadData = await threadRes.json();
          const tree = buildThreadTree(threadData.emails ?? []);
          setData({ ...threadData, tree, pagination: threadData.pagination });
          setEmailPage(1);
        }

        if (patchRes.ok) {
          const patchData = await patchRes.json();
          setPatches(patchData.patches ?? []);
        }
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [id]);

  if (loading) {
    return (
      <div className="p-6">
        <RetroSpinner label="loading thread" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="p-6 text-[#ff4444] text-sm">
        [error] thread not found: {id}
      </div>
    );
  }

  const { thread } = data;
  const badge = getThreadBadge(thread);

  return (
    <div className="p-6 max-w-5xl">
      {/* Thread metadata box */}
      <div className="retro-card p-4 mb-6 font-mono text-[12px]">
        <div className="text-[#004d14] text-[11px] mb-3">// THREAD_METADATA</div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div>
            <span className="text-[#004d14]">SUBJECT: </span>
            <span className="text-[#00ff41] font-bold">{thread.subject}</span>
          </div>

          <div>
            <span className="text-[#004d14]">STATUS: </span>
            <span
              className={`
                ${badge.variant === "committed" ? "text-white" : ""}
                ${badge.variant === "in_review" ? "text-[#ffaa00]" : ""}
                ${badge.variant === "patch" ? "text-[#00ffff]" : ""}
                ${badge.variant === "discussion" ? "text-[#004d14]" : ""}
              `}
            >
              {badge.label}
              {thread.commitfest_id && ` CommitFest ${thread.commitfest_id}`}
            </span>
          </div>

          <div>
            <span className="text-[#004d14]">AUTHORS: </span>
            <span className="text-[#00cc33]">
              {thread.participant_count ?? 0} participants
            </span>
            <span className="text-[#004d14]"> · </span>
            <span className="text-[#00cc33]">
              {thread.message_count ?? 0} messages
            </span>
          </div>

          <div>
            <span className="text-[#004d14]">DATE: </span>
            <span className="text-[#ccffcc]">
              {formatDateRange(thread.date_start, thread.date_end)}
            </span>
          </div>

          {thread.has_patches && (
            <div>
              <span className="text-[#004d14]">PATCHES: </span>
              <span className="text-[#00cc33]">{thread.patch_count}</span>
              {patches.length > 0 && patches[0].diff_stats && (
                <>
                  <span className="text-[#004d14]"> · </span>
                  <span className="text-[#00ff41]">
                    +{patches[0].diff_stats.lines_added}
                  </span>
                  <span className="text-[#004d14]"> / </span>
                  <span className="text-[#ff4444]">
                    -{patches[0].diff_stats.lines_removed}
                  </span>
                </>
              )}
            </div>
          )}

          {thread.pg_version_target && (
            <div>
              <span className="text-[#004d14]">TARGET: </span>
              <span className="text-[#ccffcc]">
                PostgreSQL {thread.pg_version_target}
              </span>
            </div>
          )}

          {thread.is_committed && thread.commit_hash && (
            <div>
              <span className="text-[#004d14]">COMMIT: </span>
              <a
                href={
                  thread.commit_url ??
                  `https://git.postgresql.org/gitweb/?p=postgresql.git;a=commit;h=${thread.commit_hash}`
                }
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#00ffff] hover:underline"
              >
                {thread.commit_hash.slice(0, 12)}
              </a>
            </div>
          )}
        </div>

        {thread.summary && (
          <div className="mt-3 pt-3 border-t border-[#1a2e1a]">
            <div className="text-[#004d14] text-[10px] mb-1">// AI_SUMMARY</div>
            <p className="text-[#ccffcc] text-[12px] leading-relaxed">
              {thread.summary}
            </p>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-4">
        <button
          onClick={() => setActiveTab("discussion")}
          className={`retro-btn text-[12px] ${activeTab === "discussion" ? "retro-btn-active" : ""}`}
        >
          [discussion: {data.pagination?.total ?? data.emails.length}]
        </button>
        {patches.length > 0 && (
          <button
            onClick={() => setActiveTab("patches")}
            className={`retro-btn text-[12px] ${activeTab === "patches" ? "retro-btn-active" : ""}`}
          >
            [patches: {patches.length}]
          </button>
        )}
      </div>

      {/* Content */}
      {activeTab === "discussion" ? (
        <div>
          <ThreadTree nodes={data.tree} maxDepth={5} />

          {/* Email pagination (for large threads > 100 messages) */}
          {data.pagination && data.pagination.total_pages > 1 && (
            <div className="flex items-center gap-2 mt-6 justify-center">
              <button
                onClick={() => fetchEmails(emailPage - 1, data)}
                disabled={emailPage <= 1}
                className="retro-btn text-[11px] disabled:opacity-30"
              >
                [prev]
              </button>
              <span className="text-[#004d14] text-[11px] font-mono">
                messages {(emailPage - 1) * (data.pagination.per_page) + 1}–
                {Math.min(emailPage * data.pagination.per_page, data.pagination.total)} of{" "}
                {data.pagination.total}
              </span>
              <button
                onClick={() => fetchEmails(emailPage + 1, data)}
                disabled={emailPage >= data.pagination.total_pages}
                className="retro-btn text-[11px] disabled:opacity-30"
              >
                [next]
              </button>
            </div>
          )}
        </div>
      ) : (
        <PatchViewer patches={patches} />
      )}
    </div>
  );
}
