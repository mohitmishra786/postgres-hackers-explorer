"use client";

import { Suspense, useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { AskResponse } from "@/lib/db";
import AIAnswer from "@/components/AIAnswer";
import RetroLoader, { RetroSpinner } from "@/components/RetroLoader";

const EXAMPLE_QUESTIONS = [
  "what objections were raised against parallel query in pg10?",
  "show me all discussions about logical replication 2022-2024",
  "who are the main reviewers for WAL related patches?",
  "what is the history of the MERGE command proposal?",
  "how was partitioning implemented in PostgreSQL?",
];

const LOADING_LINES = [
  `> searching archive...`,
  `> expanding thread context...`,
  `> synthesizing answer with Groq...`,
];

function AskPageInner() {
  const searchParams = useSearchParams();
  const [question, setQuestion] = useState(searchParams.get("q") ?? "");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AskResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<string[]>([]);

  // Auto-submit if ?q= is set
  useEffect(() => {
    const q = searchParams.get("q");
    if (q && q.trim()) {
      setQuestion(q);
      handleAsk(q);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleAsk = async (q?: string) => {
    const questionText = q ?? question;
    if (!questionText.trim() || loading) return;

    setLoading(true);
    setResult(null);
    setError(null);
    setHistory((prev) => [questionText, ...prev.slice(0, 4)]);

    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: questionText }),
      });

      if (res.status === 429) {
        setError("Rate limit exceeded. Please wait a minute before asking again.");
        return;
      }

      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? "Failed to generate answer.");
        return;
      }

      const data: AskResponse = await res.json();
      setResult(data);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6 max-w-4xl">
      {/* Header */}
      <div className="mb-8">
        <div className="text-[#004d14] text-[11px] mb-1">// AI_QUERY_ENGINE</div>
        <h1 className="text-2xl font-bold text-[#00ff41]">ask</h1>
        <p className="text-[#004d14] text-sm mt-1">
          Ask questions about pgsql-hackers discussions using RAG over 700k+ emails.
        </p>
      </div>

      {/* Main terminal input */}
      <div className="retro-card p-4 mb-6">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-[#004d14] text-[11px]">pghackers.com &gt;</span>
          <span className="blink text-[#00ff41] text-sm">_</span>
        </div>

        <textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              handleAsk();
            }
          }}
          placeholder="ask a question about PostgreSQL development..."
          disabled={loading}
          rows={3}
          className="w-full bg-transparent border-none outline-none text-[#00ff41] placeholder-[#004d14] text-sm font-mono resize-none caret-[#00ff41] disabled:opacity-50"
          autoFocus
        />

        <div className="flex items-center justify-between mt-3 pt-2 border-t border-[#1a2e1a]">
          <span className="text-[10px] text-[#004d14]">
            ctrl+enter to submit · rate limit: 10/min
          </span>
          <button
            onClick={() => handleAsk()}
            disabled={!question.trim() || loading}
            className="retro-btn text-[11px] disabled:opacity-30"
          >
            [submit]
          </button>
        </div>
      </div>

      {/* Example prompts (shown when no result) */}
      {!result && !loading && (
        <div className="mb-6">
          <div className="text-[#004d14] text-[11px] mb-2">// EXAMPLE_QUERIES</div>
          <div className="space-y-1">
            {EXAMPLE_QUESTIONS.map((q) => (
              <button
                key={q}
                onClick={() => {
                  setQuestion(q);
                  handleAsk(q);
                }}
                className="block text-left text-[12px] text-[#004d14] hover:text-[#00cc33] transition-colors font-mono w-full"
              >
                <span className="text-[#004d14]">$</span>{" "}
                <span className="hover:underline">{q}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Loading state */}
      {loading && (
        <div className="retro-card p-4 mb-6">
          <RetroLoader lines={LOADING_LINES} />
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="border border-[#ff4444] bg-[rgba(255,68,68,0.05)] p-3 mb-4 text-[#ff4444] text-sm font-mono">
          [error] {error}
        </div>
      )}

      {/* AI Answer */}
      {result && (
        <div>
          <div className="text-[#004d14] text-[11px] mb-2">
            // RESPONSE — {result.thread_ids.length} thread
            {result.thread_ids.length !== 1 ? "s" : ""} referenced
          </div>
          <AIAnswer
            answer={result.answer}
            sources={result.sources}
            queryId={result.query_id}
          />
        </div>
      )}

      {/* History */}
      {history.length > 0 && (
        <div className="mt-8">
          <div className="text-[#004d14] text-[11px] mb-2">// QUERY_HISTORY</div>
          <div className="space-y-1">
            {history.map((q, i) => (
              <button
                key={i}
                onClick={() => {
                  setQuestion(q);
                  handleAsk(q);
                }}
                className="block text-left text-[11px] text-[#004d14] hover:text-[#00cc33] font-mono w-full"
              >
                <span className="text-[#004d14]">↑</span>{" "}
                <span className="hover:underline">{q}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function AskPage() {
  return (
    <Suspense fallback={<div className="p-6"><RetroSpinner label="loading" /></div>}>
      <AskPageInner />
    </Suspense>
  );
}
