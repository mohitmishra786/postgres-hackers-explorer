"use client";

import { useState, useEffect } from "react";
import { Author } from "@/lib/db";
import AuthorCard from "@/components/AuthorCard";
import { RetroSpinner } from "@/components/RetroLoader";

type SortOption = "emails" | "patches" | "reviews";

export default function AuthorsPage() {
  const [authors, setAuthors] = useState<Author[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [sort, setSort] = useState<SortOption>("emails");

  const fetchAuthors = async (p: number, s: SortOption) => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/authors?page=${p}&per_page=50&sort=${s}`
      );
      const data = await res.json();
      setAuthors(data.authors ?? []);
      setTotal(data.total ?? 0);
      setPage(p);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAuthors(1, sort);
  }, [sort]);

  return (
    <div className="p-6 max-w-6xl">
      {/* Header */}
      <div className="mb-6">
        <div className="text-[#004d14] text-[11px] mb-1">// CONTRIBUTOR_DIRECTORY</div>
        <h1 className="text-2xl font-bold text-[#00ff41]">
          authors
          <span className="text-[#004d14] ml-2 text-base font-normal">
            ({total.toLocaleString()} contributors)
          </span>
        </h1>
      </div>

      {/* Sort options */}
      <div className="flex gap-2 mb-6">
        {(["emails", "patches", "reviews"] as SortOption[]).map((s) => (
          <button
            key={s}
            onClick={() => setSort(s)}
            className={`retro-btn text-[11px] ${sort === s ? "retro-btn-active" : ""}`}
          >
            --sort={s}
          </button>
        ))}
      </div>

      {/* Author grid */}
      {loading ? (
        <RetroSpinner label="loading contributors" />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {authors.map((author) => (
            <AuthorCard key={author.id} author={author} />
          ))}
        </div>
      )}

      {/* Pagination */}
      {Math.ceil(total / 50) > 1 && (
        <div className="flex items-center gap-2 mt-6 justify-center">
          <button
            onClick={() => fetchAuthors(page - 1, sort)}
            disabled={page <= 1}
            className="retro-btn text-[11px] disabled:opacity-30"
          >
            [prev]
          </button>
          <span className="text-[#004d14] text-[11px] font-mono">
            {page} / {Math.ceil(total / 50)}
          </span>
          <button
            onClick={() => fetchAuthors(page + 1, sort)}
            disabled={page >= Math.ceil(total / 50)}
            className="retro-btn text-[11px] disabled:opacity-30"
          >
            [next]
          </button>
        </div>
      )}
    </div>
  );
}
