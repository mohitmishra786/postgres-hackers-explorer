"use client";

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { SourceEmail } from "@/lib/db";
import { formatDate, truncate } from "@/lib/utils";
import Link from "next/link";
import { motion } from "framer-motion";

interface AIAnswerProps {
  answer: string;
  sources: SourceEmail[];
  queryId?: string;
}

export default function AIAnswer({ answer, sources, queryId }: AIAnswerProps) {
  const [expandedSource, setExpandedSource] = useState<string | null>(null);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="space-y-4"
    >
      {/* Answer box */}
      <div className="retro-card p-4">
        <div className="flex items-center gap-2 mb-3 pb-2 border-b border-[#1a2e1a]">
          <span className="text-[#004d14] text-[11px]">// AI_RESPONSE</span>
          {queryId && (
            <span className="text-[#004d14] text-[10px] ml-auto">
              qid:{queryId.slice(0, 8)}
            </span>
          )}
        </div>

        <div className="prose-retro">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{answer}</ReactMarkdown>
        </div>
      </div>

      {/* Sources */}
      {sources.length > 0 && (
        <div className="space-y-2">
          <div className="text-[11px] text-[#004d14] border-b border-[#1a2e1a] pb-1">
            // SOURCES ({sources.length})
          </div>

          {sources.map((source, i) => (
            <div
              key={source.message_id}
              className="border border-[#1a2e1a] bg-[#0d0d0d]"
            >
              {/* Source header */}
              <button
                className="w-full flex items-start gap-3 p-3 text-left hover:bg-[#0a1a0a] transition-colors"
                onClick={() =>
                  setExpandedSource(
                    expandedSource === source.message_id
                      ? null
                      : source.message_id
                  )
                }
              >
                <span className="text-[#004d14] text-[11px] font-bold flex-shrink-0">
                  [{i + 1}]
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-[#00cc33] text-[12px] font-bold truncate">
                    {source.subject}
                  </div>
                  <div className="text-[11px] text-[#004d14] mt-0.5">
                    <Link
                      href={`/authors/${encodeURIComponent(source.author_name ?? "unknown")}`}
                      onClick={(e) => e.stopPropagation()}
                      className="text-[#00cc33] hover:underline"
                    >
                      [{source.author_name ?? "unknown"}]
                    </Link>
                    {" · "}
                    {formatDate(source.date)}
                  </div>
                </div>
                <span className="text-[10px] text-[#004d14] flex-shrink-0">
                  {expandedSource === source.message_id ? "▲" : "▼"}
                </span>
              </button>

              {/* Source excerpt (expanded) */}
              {expandedSource === source.message_id && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="overflow-hidden"
                >
                  <div className="px-4 pb-3 border-t border-[#1a2e1a]">
                    <p className="text-[12px] text-[#ccffcc] mt-2 leading-relaxed">
                      {source.excerpt}
                    </p>
                    <div className="flex gap-3 mt-2">
                      {source.thread_root_id && (
                        <Link
                          href={`/threads/${encodeURIComponent(source.thread_root_id)}`}
                          className="text-[11px] text-[#004d14] hover:text-[#00cc33] border border-[#1a2e1a] px-2 py-0.5 hover:border-[#004d14] transition-colors"
                        >
                          [view thread]
                        </Link>
                      )}
                      {source.source_url && (
                        <a
                          href={source.source_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[11px] text-[#004d14] hover:text-[#00cc33] border border-[#1a2e1a] px-2 py-0.5 hover:border-[#004d14] transition-colors"
                        >
                          [original]
                        </a>
                      )}
                    </div>
                  </div>
                </motion.div>
              )}
            </div>
          ))}
        </div>
      )}
    </motion.div>
  );
}
