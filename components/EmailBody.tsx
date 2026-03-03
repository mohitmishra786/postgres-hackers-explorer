"use client";

import { useState } from "react";
import { Email } from "@/lib/db";
import { formatDate, buildGitUrl } from "@/lib/utils";
import CodeBlock from "./CodeBlock";
import Link from "next/link";

interface EmailBodyProps {
  email: Email;
  showMeta?: boolean;
}

/**
 * Detect if text contains a git diff.
 */
function hasDiff(text: string): boolean {
  return (
    text.includes("diff --git") ||
    (text.includes("--- a/") && text.includes("+++ b/"))
  );
}

type Section = { type: "text" | "diff" | "code"; content: string; language?: string };

/** Map common fence language tags to highlight.js language IDs */
const FENCE_LANG_MAP: Record<string, string> = {
  diff: "diff",
  patch: "diff",
  c: "c",
  cpp: "cpp",
  sql: "sql",
  plpgsql: "sql",
  sh: "bash",
  bash: "bash",
  shell: "bash",
  text: "text",
  makefile: "makefile",
  perl: "perl",
  python: "python",
  py: "python",
};

/**
 * Detect if a block of text looks like a git diff.
 */
function isDiffBlock(text: string): boolean {
  return (
    text.includes("diff --git") ||
    (text.includes("--- a/") && text.includes("+++ b/")) ||
    /^diff -/m.test(text)
  );
}

/**
 * Split email body into sections: text, diff, and fenced code blocks.
 * Handles:
 *   - ```diff / ```c / ```sql / ``` fenced blocks
 *   - Inline git diffs (diff --git / --- a/ lines)
 *   - Plain prose
 */
function parseEmailBody(body: string): Section[] {
  const sections: Section[] = [];
  const lines = body.split("\n");

  let i = 0;

  const flush = (type: Section["type"], buf: string[], language?: string) => {
    const content = buf.join("\n").trim();
    if (content) sections.push({ type, content, language });
  };

  while (i < lines.length) {
    const line = lines[i];

    // ── Backtick-fenced code block ─────────────────────────────────────────
    const fenceMatch = line.match(/^```(\w*)$/);
    if (fenceMatch) {
      const fenceLang = fenceMatch[1].toLowerCase();
      const hlLang = FENCE_LANG_MAP[fenceLang] || (fenceLang || "text");
      i++;
      const buf: string[] = [];
      while (i < lines.length && !lines[i].startsWith("```")) {
        buf.push(lines[i]);
        i++;
      }
      i++; // consume closing ```
      const content = buf.join("\n");
      if (isDiffBlock(content)) {
        flush("diff", buf);
      } else {
        flush("code", buf, hlLang);
      }
      continue;
    }

    // ── Inline diff start ─────────────────────────────────────────────────
    if (
      line.startsWith("diff --git") ||
      line.startsWith("diff -") ||
      (line.startsWith("--- a/") && i + 1 < lines.length && lines[i + 1].startsWith("+++ b/"))
    ) {
      const buf: string[] = [];
      while (i < lines.length) {
        const l = lines[i];
        // Heuristic end: blank line followed by a prose-looking line
        if (l === "" && i + 1 < lines.length) {
          const next = lines[i + 1];
          if (next && !/^[+\-@ d]/.test(next) && !next.startsWith("diff")) {
            break;
          }
        }
        buf.push(l);
        i++;
      }
      flush("diff", buf);
      continue;
    }

    // ── Plain text ────────────────────────────────────────────────────────
    const textBuf: string[] = [];
    while (i < lines.length) {
      const l = lines[i];
      // Stop before a fence or diff start
      if (
        l.match(/^```/) ||
        l.startsWith("diff --git") ||
        l.startsWith("diff -") ||
        (l.startsWith("--- a/") && i + 1 < lines.length && lines[i + 1].startsWith("+++ b/"))
      ) {
        break;
      }
      textBuf.push(l);
      i++;
    }
    flush("text", textBuf);
  }

  return sections;
}

export default function EmailBody({ email, showMeta = true }: EmailBodyProps) {
  const [showQuoted, setShowQuoted] = useState(false);
  const body = email.body_new_content || email.body_clean || "";
  const fullBody = email.body_clean || "";

  // Count quoted lines
  const quotedLines = fullBody
    .split("\n")
    .filter((l) => l.trimStart().startsWith(">")).length;

  const sections = parseEmailBody(body);

  // Highlight git commit refs
  const renderText = (text: string) => {
    const gitRefPattern = /\b([0-9a-f]{7,40})\b/g;
    const parts = text.split(gitRefPattern);

    // If any git refs exist in email
    if (email.git_commit_refs && email.git_commit_refs.length > 0) {
      return parts.map((part, i) => {
        if (
          i % 2 === 1 &&
          email.git_commit_refs!.some((ref) => ref.startsWith(part) || part.startsWith(ref.slice(0, 7)))
        ) {
          return (
            <a
              key={i}
              href={buildGitUrl(part)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[#00ffff] hover:underline"
            >
              commit:{part}
            </a>
          );
        }
        return <span key={i}>{part}</span>;
      });
    }

    return text;
  };

  return (
    <div className="text-sm">
      {/* Email meta */}
      {showMeta && (
        <div className="mb-3 pb-3 border-b border-[#1a2e1a] space-y-1 text-[12px]">
          <div>
            <span className="text-[#004d14]">from: </span>
            <Link
              href={`/authors/${encodeURIComponent(email.author_name ?? "unknown")}`}
              className="text-[#00cc33] hover:underline"
            >
              [{email.author_name ?? "unknown"}]
            </Link>
          </div>
          <div>
            <span className="text-[#004d14]">date: </span>
            <span className="text-[#ccffcc]">{formatDate(email.date)}</span>
          </div>
          {email.has_patch && (
            <div>
              <span className="text-[10px] border border-[#00ffff] text-[#00ffff] px-1">
                [PATCH{email.patch_version ? ` ${email.patch_version}` : ""}]
              </span>
            </div>
          )}
          {email.git_commit_refs && email.git_commit_refs.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {email.git_commit_refs.map((ref) => (
                <a
                  key={ref}
                  href={buildGitUrl(ref)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[10px] border border-[#004d14] text-[#00ccff] px-1 hover:border-[#00ccff]"
                >
                  commit:{ref.slice(0, 8)}
                </a>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Body sections */}
      <div className="space-y-3">
        {sections.map((section, i) => {
          if (section.type === "diff") {
            return (
              <CodeBlock
                key={i}
                code={section.content}
                isDiff={true}
                maxLines={200}
              />
            );
          }

          if (section.type === "code") {
            return (
              <CodeBlock
                key={i}
                code={section.content}
                language={section.language || "text"}
                maxLines={50}
              />
            );
          }

          return (
            <div
              key={i}
              className="text-[#ccffcc] leading-relaxed whitespace-pre-wrap text-[13px]"
            >
              {renderText(section.content)}
            </div>
          );
        })}
      </div>

      {/* Quoted text toggle */}
      {quotedLines > 0 && (
        <div className="mt-3">
          <button
            onClick={() => setShowQuoted(!showQuoted)}
            className="text-[11px] text-[#004d14] hover:text-[#00cc33] transition-colors border border-[#1a2e1a] px-2 py-0.5 hover:border-[#004d14]"
          >
            {showQuoted
              ? `[hide ${quotedLines} quoted lines]`
              : `[show ${quotedLines} quoted lines]`}
          </button>

          {showQuoted && (
            <div className="mt-2 pl-3 border-l-2 border-[#1a2e1a] text-[#004d14] text-[12px] whitespace-pre-wrap">
              {fullBody
                .split("\n")
                .filter((l) => l.trimStart().startsWith(">"))
                .join("\n")}
            </div>
          )}
        </div>
      )}

      {/* Source link */}
      {email.source_url && (
        <div className="mt-3 pt-2 border-t border-[#1a2e1a]">
          <a
            href={email.source_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[11px] text-[#004d14] hover:text-[#00cc33] transition-colors"
          >
            [view original on postgresql.org]
          </a>
        </div>
      )}
    </div>
  );
}
