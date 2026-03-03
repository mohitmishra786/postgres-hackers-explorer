"use client";

import { useState, useEffect, useRef } from "react";
import hljs from "highlight.js";

/** Derive highlight.js language from a filename extension. */
function langFromFilename(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    c: "c", h: "c",
    cpp: "cpp", cc: "cpp", cxx: "cpp", hpp: "cpp",
    sql: "sql",
    pl: "perl", pm: "perl",
    py: "python",
    rb: "ruby",
    sh: "bash", bash: "bash",
    mk: "makefile", mak: "makefile",
    json: "json",
    yaml: "yaml", yml: "yaml",
    ts: "typescript", tsx: "typescript",
    js: "javascript", jsx: "javascript",
    go: "go",
    rs: "rust",
  };
  return map[ext] || "text";
}

interface CodeBlockProps {
  code: string;
  language?: string;
  isDiff?: boolean;
  filename?: string;
  maxLines?: number;
}

export default function CodeBlock({
  code,
  language = "text",
  isDiff = false,
  filename,
  maxLines = 200,
}: CodeBlockProps) {
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const codeRef = useRef<HTMLElement>(null);

  const lines = code.split("\n");
  const isLong = lines.length > maxLines;
  const displayLines = isLong && !expanded ? lines.slice(0, maxLines) : lines;

  // Resolve final language: filename wins over explicit language prop
  const resolvedLang = filename ? langFromFilename(filename) : language;

  useEffect(() => {
    if (codeRef.current && !isDiff) {
      // Reset any previous highlight so re-runs work
      codeRef.current.removeAttribute("data-highlighted");
      hljs.highlightElement(codeRef.current);
    }
  }, [code, isDiff, expanded, resolvedLang]);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const renderDiffLine = (line: string, i: number) => {
    let className = "text-[#ccffcc]";
    let prefix = " ";

    if (line.startsWith("+++") || line.startsWith("---")) {
      className = "diff-header font-bold";
    } else if (line.startsWith("@@")) {
      className = "text-[#66ccff] bg-[rgba(0,150,255,0.08)]";
    } else if (line.startsWith("+")) {
      className = "diff-added";
      prefix = "+";
    } else if (line.startsWith("-")) {
      className = "diff-removed";
      prefix = "-";
    }

    return (
      <div key={i} className={`flex ${className}`}>
        <span className="select-none text-[#004d14] w-8 text-right pr-2 flex-shrink-0 text-xs border-r border-[#1a2e1a] mr-2">
          {i + 1}
        </span>
        <span className="flex-1 whitespace-pre-wrap break-words font-mono text-xs">
          {line}
        </span>
      </div>
    );
  };

  const renderCodeLine = (line: string, i: number) => (
    <div key={i} className="flex">
      <span className="select-none text-[#004d14] w-8 text-right pr-2 flex-shrink-0 text-xs border-r border-[#1a2e1a] mr-2">
        {i + 1}
      </span>
      <span className="flex-1 whitespace-pre-wrap break-words">{line}</span>
    </div>
  );

  return (
    <div className="relative border border-[#1a2e1a] bg-[#080808] font-mono text-xs">
      {/* Header bar */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-[#1a2e1a] bg-[#0d0d0d]">
        <span className="text-[#004d14]">
          {filename ? (
            <span className="text-[#00cc33]">{filename}</span>
          ) : isDiff ? (
            <span className="text-[#004d14]">diff</span>
          ) : (
            <span className="text-[#004d14]">{language}</span>
          )}
        </span>
        <button
          onClick={handleCopy}
          className="text-[10px] text-[#004d14] hover:text-[#00ff41] transition-colors border border-[#1a2e1a] px-2 py-0.5 hover:border-[#00ff41]"
        >
          {copied ? "[COPIED]" : "[COPY]"}
        </button>
      </div>

      {/* Code content */}
      <div className="overflow-x-auto max-h-[600px] overflow-y-auto p-0">
        {isDiff ? (
          <div className="p-2">
            {displayLines.map((line, i) => renderDiffLine(line, i))}
          </div>
        ) : (
          <pre className="p-3 m-0 overflow-x-auto">
            <code ref={codeRef} className={`language-${resolvedLang}`}>
              {displayLines.join("\n")}
            </code>
          </pre>
        )}
      </div>

      {/* Expand/collapse for long diffs */}
      {isLong && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full text-center py-1.5 text-[11px] text-[#004d14] hover:text-[#00ff41] border-t border-[#1a2e1a] hover:bg-[#0a1a0a] transition-all"
        >
          {expanded
            ? `[collapse diff]`
            : `[show full diff: ${lines.length} lines]`}
        </button>
      )}
    </div>
  );
}
