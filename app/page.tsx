import Link from "next/link";

export default function HomePage() {
  return (
    <div className="p-8 max-w-3xl">
      {/* Hero */}
      <div className="mb-10">
        <div className="text-[#004d14] text-sm mb-2">
          // PostgreSQL Hackers Archive Explorer
        </div>
        <h1 className="text-4xl font-bold text-[#00ff41] leading-tight mb-1">
          pghackers.com
          <span className="blink text-[#00ff41]">_</span>
        </h1>
        <p className="text-[#00cc33] text-base mt-3 leading-relaxed">
          AI-powered reader for the pgsql-hackers mailing list.
          <br />
          Browse 700k+ emails, explore patches, and ask questions
          about PostgreSQL development.
        </p>
      </div>

      {/* Quick nav */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-10">
        {[
          {
            href: "/threads",
            cmd: "browse-threads",
            desc: "Explore discussion threads sorted by activity, patch status, or commitfest",
          },
          {
            href: "/ask",
            cmd: "ask-ai",
            desc: "Ask natural language questions answered using RAG over the full archive",
          },
          {
            href: "/search",
            cmd: "search-emails",
            desc: "Full-text and semantic vector search across all emails",
          },
          {
            href: "/patches",
            cmd: "patch-dashboard",
            desc: "Browse all threads with patches, diff stats, and commitfest status",
          },
        ].map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="retro-card p-4 block group"
          >
            <div className="text-[#00ff41] font-bold text-sm mb-1 group-hover:text-[#00ff41]">
              &gt; {item.cmd}
            </div>
            <div className="text-[#004d14] text-[12px] leading-snug">
              {item.desc}
            </div>
          </Link>
        ))}
      </div>

      {/* Example questions */}
      <div className="border border-[#1a2e1a] p-4 bg-[#0d0d0d]">
        <div className="text-[#004d14] text-[11px] mb-3">
          // EXAMPLE_QUERIES — try these in /ask
        </div>
        <div className="space-y-2">
          {[
            "what objections were raised against parallel query in pg10?",
            "show me all discussions about logical replication 2022-2024",
            "who are the main reviewers for WAL related patches?",
            "what is the history of the MERGE command proposal?",
            "which patches from commitfest 2024-01 were committed?",
          ].map((q) => (
            <Link
              key={q}
              href={`/ask?q=${encodeURIComponent(q)}`}
              className="block text-[12px] text-[#004d14] hover:text-[#00cc33] transition-colors font-mono"
            >
              <span className="text-[#004d14]">$</span>{" "}
              <span className="hover:underline">{q}</span>
            </Link>
          ))}
        </div>
      </div>

      {/* Archive info */}
      <div className="mt-6 text-[11px] text-[#004d14] space-y-1">
        <div>
          source:{" "}
          <a
            href="https://lists.postgresql.org/pgsql-hackers/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[#004d14] hover:text-[#00cc33]"
          >
            lists.postgresql.org/pgsql-hackers
          </a>
        </div>
        <div>
          embeddings: HuggingFace BAAI/bge-small-en-v1.5 · vector search via pgvector
        </div>
        <div>
          LLM: Groq llama-3.3-70b-versatile (answers) · llama-3.1-8b-instant (summaries)
        </div>
      </div>
    </div>
  );
}
