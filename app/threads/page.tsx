"use client";

import { Suspense, useState, useEffect, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Thread } from "@/lib/db";
import ThreadCard from "@/components/ThreadCard";
import { RetroSpinner } from "@/components/RetroLoader";

type SortOption = "recent" | "active" | "patches" | "committed";
type FilterOption = "has_patches" | "committed" | "in_review" | "";

const SORT_OPTIONS: { value: SortOption; label: string }[] = [
  { value: "recent", label: "--sort=recent" },
  { value: "active", label: "--sort=active" },
  { value: "patches", label: "--sort=patches" },
  { value: "committed", label: "--sort=committed" },
];

const FILTER_OPTIONS: { value: FilterOption; label: string }[] = [
  { value: "", label: "--filter=all" },
  { value: "has_patches", label: "--filter=patches" },
  { value: "in_review", label: "--filter=in_review" },
  { value: "committed", label: "--filter=committed" },
];

function ThreadsPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [threads, setThreads] = useState<Thread[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState(searchParams.get("search") ?? "");
  const [sort, setSort] = useState<SortOption>(
    (searchParams.get("sort") as SortOption) ?? "recent"
  );
  const [filter, setFilter] = useState<FilterOption>(
    (searchParams.get("filter") as FilterOption) ?? ""
  );

  const fetchThreads = useCallback(
    async (p: number = 1) => {
      setLoading(true);
      try {
        const params = new URLSearchParams({
          page: String(p),
          per_page: "30",
          sort,
          ...(filter && { filter }),
          ...(search && { search }),
        });
        const res = await fetch(`/api/threads?${params}`);
        const data = await res.json();
        setThreads(data.threads ?? []);
        setTotal(data.total ?? 0);
        setPage(p);
      } catch {
        // ignore
      } finally {
        setLoading(false);
      }
    },
    [sort, filter, search]
  );

  useEffect(() => {
    fetchThreads(1);
  }, [fetchThreads]);

  const PER_PAGE = 30;
  const totalPages = Math.ceil(total / PER_PAGE);

  return (
    <div className="p-6">
      {/* Header */}
      <div className="mb-6">
        <div className="text-[#004d14] text-[11px] mb-1">// THREAD_BROWSER</div>
        <h1 className="text-2xl font-bold text-[#00ff41]">
          threads
          <span className="text-[#004d14] ml-2 text-base font-normal">
            ({total.toLocaleString()} total)
          </span>
        </h1>
      </div>

      {/* Filter bar */}
      <div className="mb-4 space-y-2">
        {/* Search */}
        <div className="flex items-center gap-2 retro-input px-3 py-1.5">
          <span className="text-[#004d14] text-sm select-none">&gt;</span>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && fetchThreads(1)}
            placeholder="filter by subject..."
            className="flex-1 bg-transparent border-none outline-none text-[#00ff41] placeholder-[#004d14] text-sm font-mono"
          />
          {search && (
            <button
              onClick={() => {
                setSearch("");
                fetchThreads(1);
              }}
              className="text-[#004d14] text-xs hover:text-[#ff4444]"
            >
              [clear]
            </button>
          )}
        </div>

        {/* Sort + filter chips */}
        <div className="flex flex-wrap gap-2">
          <div className="flex gap-1 flex-wrap">
            {SORT_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setSort(opt.value)}
                className={`retro-btn text-[11px] ${sort === opt.value ? "retro-btn-active" : ""}`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <div className="flex gap-1 flex-wrap">
            {FILTER_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setFilter(opt.value)}
                className={`retro-btn text-[11px] ${filter === opt.value ? "retro-btn-active" : ""}`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Thread list */}
      {loading ? (
        <div className="py-8">
          <RetroSpinner label="fetching threads" />
        </div>
      ) : threads.length === 0 ? (
        <div className="text-[#004d14] text-sm py-8 text-center">
          no threads found matching your filters
        </div>
      ) : (
        <div className="space-y-2">
          {threads.map((thread) => (
            <ThreadCard
              key={thread.id}
              thread={thread}
              onClick={() =>
                router.push(
                  `/threads/${encodeURIComponent(thread.root_message_id)}`
                )
              }
            />
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center gap-2 mt-6 justify-center">
          <button
            onClick={() => fetchThreads(page - 1)}
            disabled={page <= 1}
            className="retro-btn text-[11px] disabled:opacity-30"
          >
            [prev]
          </button>
          <span className="text-[#004d14] text-[11px] font-mono">
            page {page} / {totalPages}
          </span>
          <button
            onClick={() => fetchThreads(page + 1)}
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

export default function ThreadsPage() {
  return (
    <Suspense fallback={<div className="p-6"><RetroSpinner label="loading" /></div>}>
      <ThreadsPageInner />
    </Suspense>
  );
}
