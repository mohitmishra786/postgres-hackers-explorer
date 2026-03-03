"use client";

import Link from "next/link";
import { Author } from "@/lib/db";
import { formatDateShort, getAuthorInitials } from "@/lib/utils";

interface AuthorCardProps {
  author: Author;
}

export default function AuthorCard({ author }: AuthorCardProps) {
  const initials = getAuthorInitials(author.name);

  return (
    <div className="retro-card p-3 space-y-2 hover:retro-card-active">
      {/* Header */}
      <div className="flex items-center gap-2">
        {/* Avatar */}
        <div className="w-8 h-8 border border-[#1a2e1a] bg-[#0a1a0a] flex items-center justify-center flex-shrink-0 text-[11px] font-bold text-[#00cc33]">
          {initials}
        </div>
        <div className="flex-1 min-w-0">
          <Link
            href={`/authors/${encodeURIComponent(author.name)}`}
            className="text-[#00ff41] text-sm font-bold hover:underline truncate block"
          >
            {author.name}
          </Link>
          {author.company && (
            <div className="text-[10px] text-[#004d14]">{author.company}</div>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="text-[11px] text-[#004d14] space-y-0.5">
        <div>
          emails: <span className="text-[#00cc33]">{author.email_count.toLocaleString()}</span>
          {author.patch_count > 0 && (
            <>
              {" · "}patches:{" "}
              <span className="text-[#00cc33]">{author.patch_count}</span>
            </>
          )}
          {author.review_count > 0 && (
            <>
              {" · "}reviews:{" "}
              <span className="text-[#00cc33]">{author.review_count}</span>
            </>
          )}
        </div>
        {author.first_seen && author.last_seen && (
          <div className="text-[10px]">
            {formatDateShort(author.first_seen)} –{" "}
            {formatDateShort(author.last_seen)}
          </div>
        )}
      </div>

      {/* Topic tags */}
      {author.topic_tags && author.topic_tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {author.topic_tags.slice(0, 4).map((tag) => (
            <span
              key={tag}
              className="text-[10px] border border-[#1a2e1a] text-[#004d14] px-1 py-0.5"
            >
              [{tag}]
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
