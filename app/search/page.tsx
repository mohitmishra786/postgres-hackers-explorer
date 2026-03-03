"use client";

import { useState } from "react";
import Link from "next/link";
import { formatDate } from "@/lib/utils";
import { RetroSpinner } from "@/components/RetroLoader";

interface SearchResult {
  id: string;
  message_id: string;
  subject: string;
  author_name: string | null;
  date: string;
  body_new_content: string | null;
  thread_root_id: string | null;
  has_patch?: boolean;
  rank?: number;
  similarity?: number;
}

export default function SearchPage() {
  const [kwQuery, setKwQuery] = useState("");
  const [semQuery, setSemQuery] = useState("");
  const [kwResults, setKwResults] = useState<SearchResult[]>([]);
  const [semResults, setSemResults] = useState<SearchResult[]>([]);
  const [kwLoading, setKwLoading] = useState(false);
  const [semLoading, setSemLoading] = useState(false);
  const [kwTotal, setKwTotal] = useState(0);

  const handleKeywordSearch = async () => {
    if (!kwQuery.trim()) return;
    setKwLoading(true);
    try {
      const res = await fetch(
        `/api/search/keyword?q=${encodeURIComponent(kwQuery)}&per_page=20`
      );
      const data = await res.json();
      setKwResults(data.results ?? []);
      setKwTotal(data.total ?? 0);
    } finally {
      setKwLoading(false);
    }
  };

  const handleSemanticSearch = async () => {
    if (!semQuery.trim()) return;
    setSemLoading(true);
    try {
      const res = await fetch("/api/search/semantic", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: semQuery }),
      });
      const data = await res.json();
      setSemResults(data.results ?? []);
    } finally {
      setSemLoading(false);
    }
  };

  const ResultCard = ({ result }: { result: SearchResult }) => (
    <div className="retro-card p-3 space-y-1">
      <div className="text-[10px] text-[#004d14] truncate">{result.message_id}</div>
      <Link
        href={
          result.thread_root_id
            ? `/threads/${encodeURIComponent(result.thread_root_id)}`
            : "#"
        }
        className="text-[#00ff41] text-sm font-bold hover:underline block"
      >
        {result.subject}
      </Link>
      <div className="text-[11px] text-[#004d14]">
        <span className="text-[#00cc33]">[{result.author_name ?? "unknown"}]</span>
        {" · "}
        {formatDate(result.date)}
        {result.has_patch && (
          <span className="ml-2 border border-[#00ffff] text-[#00ffff] text-[10px] px-1">
            [PATCH]
          </span>
        )}
        {result.similarity !== undefined && (
          <span className="ml-2 text-[#004d14]">
            sim: {(result.similarity * 100).toFixed(0)}%
          </span>
        )}
      </div>
      {result.body_new_content && (
        <p className="text-[12px] text-[#ccffcc] line-clamp-2 leading-relaxed">
          {result.body_new_content.slice(0, 200)}
        </p>
      )}
    </div>
  );

  return (
    <div className="p-6 max-w-6xl">
      {/* Header */}
      <div className="mb-6">
        <div className="text-[#004d14] text-[11px] mb-1">// SEARCH_ENGINE</div>
        <h1 className="text-2xl font-bold text-[#00ff41]">search</h1>
      </div>

      {/* Two-panel search */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Keyword search */}
        <div>
          <div className="text-[#004d14] text-[11px] mb-2">// KEYWORD_SEARCH</div>

          <div className="flex items-center gap-2 retro-input px-3 py-2 mb-3">
            <span className="text-[#004d14] text-sm">&gt;</span>
            <input
              type="text"
              value={kwQuery}
              onChange={(e) => setKwQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleKeywordSearch()}
              placeholder="search by keywords..."
              className="flex-1 bg-transparent border-none outline-none text-[#00ff41] placeholder-[#004d14] text-sm font-mono"
            />
            <button
              onClick={handleKeywordSearch}
              disabled={kwLoading}
              className="retro-btn text-[11px] disabled:opacity-30"
            >
              [search]
            </button>
          </div>

          {kwLoading ? (
            <RetroSpinner label="searching" />
          ) : kwResults.length > 0 ? (
            <div className="space-y-2">
              <div className="text-[10px] text-[#004d14]">
                {kwTotal.toLocaleString()} results
              </div>
              {kwResults.map((r) => (
                <ResultCard key={r.message_id} result={r} />
              ))}
            </div>
          ) : kwQuery ? (
            <div className="text-[#004d14] text-sm">no results found</div>
          ) : null}
        </div>

        {/* Semantic search */}
        <div>
          <div className="text-[#004d14] text-[11px] mb-2">// SEMANTIC_SEARCH</div>

          <div className="flex items-center gap-2 retro-input px-3 py-2 mb-3">
            <span className="text-[#004d14] text-sm">&gt;</span>
            <input
              type="text"
              value={semQuery}
              onChange={(e) => setSemQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSemanticSearch()}
              placeholder="search by meaning..."
              className="flex-1 bg-transparent border-none outline-none text-[#00ff41] placeholder-[#004d14] text-sm font-mono"
            />
            <button
              onClick={handleSemanticSearch}
              disabled={semLoading}
              className="retro-btn text-[11px] disabled:opacity-30"
            >
              [search]
            </button>
          </div>

          {semLoading ? (
            <RetroSpinner label="embedding + searching" />
          ) : semResults.length > 0 ? (
            <div className="space-y-2">
              <div className="text-[10px] text-[#004d14]">
                {semResults.length} results
              </div>
              {semResults.map((r) => (
                <ResultCard key={r.message_id} result={r} />
              ))}
            </div>
          ) : semQuery ? (
            <div className="text-[#004d14] text-sm">no results found</div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
