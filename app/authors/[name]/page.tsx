"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { Author } from "@/lib/db";
import { formatDateShort, formatDateRange } from "@/lib/utils";
import { RetroSpinner } from "@/components/RetroLoader";
import Link from "next/link";

interface AuthorPageData {
  author: Author;
  recentThreads: {
    root_message_id: string;
    subject: string;
    date_start: string | null;
  }[];
}

export default function AuthorDetailPage() {
  const params = useParams();
  const name = decodeURIComponent(params.name as string);
  const [data, setData] = useState<AuthorPageData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        // Fetch author from authors table
        const res = await fetch(
          `/api/authors?page=1&per_page=100`
        );
        const authorsData = await res.json();
        const author = authorsData.authors?.find(
          (a: Author) => a.name === name
        );

        if (!author) {
          setLoading(false);
          return;
        }

        // Fetch recent threads this author participated in
        const threadsRes = await fetch(
          `/api/threads?search=${encodeURIComponent(name)}&per_page=10`
        );
        const threadsData = await threadsRes.json();

        setData({
          author,
          recentThreads: (threadsData.threads ?? []).slice(0, 10).map(
            (t: { root_message_id: string; subject: string; date_start: string | null }) => ({
              root_message_id: t.root_message_id,
              subject: t.subject,
              date_start: t.date_start,
            })
          ),
        });
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [name]);

  if (loading) {
    return (
      <div className="p-6">
        <RetroSpinner label="loading author" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="p-6 text-[#ff4444] text-sm">
        [error] author not found: {name}
      </div>
    );
  }

  const { author } = data;

  return (
    <div className="p-6 max-w-3xl">
      <div className="text-[#004d14] text-[11px] mb-4">// AUTHOR_PROFILE</div>

      {/* Author card */}
      <div className="retro-card p-5 mb-6">
        <h1 className="text-xl font-bold text-[#00ff41] mb-1">{author.name}</h1>
        {author.company && (
          <div className="text-[#004d14] text-sm mb-3">{author.company}</div>
        )}

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-[12px] font-mono mb-4">
          <div>
            <span className="text-[#004d14]">emails: </span>
            <span className="text-[#00ff41]">{author.email_count.toLocaleString()}</span>
          </div>
          <div>
            <span className="text-[#004d14]">patches: </span>
            <span className="text-[#00ff41]">{author.patch_count}</span>
          </div>
          <div>
            <span className="text-[#004d14]">reviews: </span>
            <span className="text-[#00ff41]">{author.review_count}</span>
          </div>
          {author.first_seen && (
            <div>
              <span className="text-[#004d14]">first seen: </span>
              <span className="text-[#ccffcc]">{formatDateShort(author.first_seen)}</span>
            </div>
          )}
          {author.last_seen && (
            <div>
              <span className="text-[#004d14]">last seen: </span>
              <span className="text-[#ccffcc]">{formatDateShort(author.last_seen)}</span>
            </div>
          )}
        </div>

        {author.topic_tags && author.topic_tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {author.topic_tags.map((tag) => (
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

      {/* Recent threads */}
      <div>
        <div className="text-[#004d14] text-[11px] mb-3">// RECENT_THREADS</div>
        <div className="space-y-2">
          {data.recentThreads.length === 0 ? (
            <div className="text-[#004d14] text-sm">no threads found</div>
          ) : (
            data.recentThreads.map((t) => (
              <Link
                key={t.root_message_id}
                href={`/threads/${encodeURIComponent(t.root_message_id)}`}
                className="block retro-card p-3 hover:retro-card-active"
              >
                <div className="text-[#00ff41] text-sm font-bold hover:underline">
                  {t.subject}
                </div>
                {t.date_start && (
                  <div className="text-[10px] text-[#004d14] mt-1">
                    {formatDateShort(t.date_start)}
                  </div>
                )}
              </Link>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
