"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { formatDateShort } from "@/lib/utils";
import { RetroSpinner } from "@/components/RetroLoader";
import Link from "next/link";

interface AuthorProfileThread {
  root_message_id: string;
  subject: string;
  date_start: string | null;
  date_end: string | null;
  message_count: number;
  has_patches: boolean;
}

interface AuthorProfileEmail {
  message_id: string;
  subject: string;
  date: string;
  thread_root_id: string | null;
  has_patch: boolean;
  patch_version: string | null;
  source_url: string | null;
  body_new_content: string | null;
}

interface AuthorProfile {
  name: string;
  email_obfuscated: string | null;
  email_count: number;
  patch_count: number;
  review_count: number;
  first_seen: string | null;
  last_seen: string | null;
  topic_tags: string[] | null;
  threads: AuthorProfileThread[];
  recent_emails: AuthorProfileEmail[];
}

type Tab = "threads" | "patches" | "recent";

export default function AuthorDetailPage() {
  const params = useParams();
  const name = decodeURIComponent(params.name as string);
  const [profile, setProfile] = useState<AuthorProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("threads");

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/authors/${encodeURIComponent(name)}`);
        if (!res.ok) {
          setProfile(null);
          return;
        }
        const data: AuthorProfile = await res.json();
        setProfile(data);
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

  if (!profile) {
    return (
      <div className="p-6 text-[#ff4444] text-sm">
        [error] author not found: {name}
      </div>
    );
  }

  const patches = profile.recent_emails.filter((e) => e.has_patch);

  return (
    <div className="p-6 max-w-3xl">
      <div className="text-[#004d14] text-[11px] mb-4">// AUTHOR_PROFILE</div>

      {/* Stats card */}
      <div className="retro-card p-5 mb-6">
        <h1 className="text-xl font-bold text-[#00ff41] mb-1">{profile.name}</h1>
        {profile.email_obfuscated && (
          <div className="text-[#004d14] text-[11px] mb-3 font-mono">
            {profile.email_obfuscated}
          </div>
        )}

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-[12px] font-mono mb-4">
          <div>
            <span className="text-[#004d14]">emails: </span>
            <span className="text-[#00ff41]">{profile.email_count.toLocaleString()}</span>
          </div>
          <div>
            <span className="text-[#004d14]">patches: </span>
            <span className="text-[#00ff41]">{profile.patch_count}</span>
          </div>
          <div>
            <span className="text-[#004d14]">reviews: </span>
            <span className="text-[#00ff41]">{profile.review_count}</span>
          </div>
          {profile.first_seen && (
            <div>
              <span className="text-[#004d14]">first seen: </span>
              <span className="text-[#ccffcc]">{formatDateShort(profile.first_seen)}</span>
            </div>
          )}
          {profile.last_seen && (
            <div>
              <span className="text-[#004d14]">last seen: </span>
              <span className="text-[#ccffcc]">{formatDateShort(profile.last_seen)}</span>
            </div>
          )}
          <div>
            <span className="text-[#004d14]">threads: </span>
            <span className="text-[#00ff41]">{profile.threads.length}</span>
          </div>
        </div>

        {profile.topic_tags && profile.topic_tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {profile.topic_tags.map((tag) => (
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

      {/* Tabs */}
      <div className="flex gap-1 mb-4">
        {(["threads", "patches", "recent"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`text-[11px] font-mono px-3 py-1 border transition-all ${
              tab === t
                ? "border-[#00ff41] text-[#00ff41] bg-[#004d14]"
                : "border-[#1a2e1a] text-[#004d14] hover:border-[#004d14] hover:text-[#00cc33]"
            }`}
          >
            [{t}]
          </button>
        ))}
      </div>

      {/* Threads tab */}
      {tab === "threads" && (
        <div className="space-y-2">
          <div className="text-[#004d14] text-[11px] mb-3">
            // THREADS ({profile.threads.length})
          </div>
          {profile.threads.length === 0 ? (
            <div className="text-[#004d14] text-sm">no threads found</div>
          ) : (
            profile.threads.map((t) => (
              <Link
                key={t.root_message_id}
                href={`/threads/${encodeURIComponent(t.root_message_id)}`}
                className="block retro-card p-3 hover:retro-card-active"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="text-[#00ff41] text-sm font-bold hover:underline flex-1 min-w-0 truncate">
                    {t.subject}
                  </div>
                  <div className="flex gap-1 flex-shrink-0">
                    {t.has_patches && (
                      <span className="text-[10px] border border-[#00ffff] text-[#00ffff] px-1">
                        [PATCH]
                      </span>
                    )}
                    <span className="text-[10px] text-[#004d14]">
                      {t.message_count} msg{t.message_count !== 1 ? "s" : ""}
                    </span>
                  </div>
                </div>
                {t.date_start && (
                  <div className="text-[10px] text-[#004d14] mt-1">
                    {formatDateShort(t.date_start)}
                    {t.date_end && t.date_end !== t.date_start && (
                      <> → {formatDateShort(t.date_end)}</>
                    )}
                  </div>
                )}
              </Link>
            ))
          )}
        </div>
      )}

      {/* Patches tab */}
      {tab === "patches" && (
        <div className="space-y-2">
          <div className="text-[#004d14] text-[11px] mb-3">
            // PATCHES ({patches.length})
          </div>
          {patches.length === 0 ? (
            <div className="text-[#004d14] text-sm">no patches found</div>
          ) : (
            patches.map((e) => (
              <Link
                key={e.message_id}
                href={
                  e.thread_root_id
                    ? `/threads/${encodeURIComponent(e.thread_root_id)}`
                    : "#"
                }
                className="block retro-card p-3 hover:retro-card-active"
              >
                <div className="flex items-center gap-2">
                  <span className="text-[10px] border border-[#00ffff] text-[#00ffff] px-1 flex-shrink-0">
                    [PATCH{e.patch_version ? ` ${e.patch_version}` : ""}]
                  </span>
                  <span className="text-[#00ff41] text-sm font-bold truncate">
                    {e.subject}
                  </span>
                </div>
                <div className="text-[10px] text-[#004d14] mt-1">
                  {formatDateShort(e.date)}
                </div>
                {e.body_new_content && (
                  <p className="text-[11px] text-[#ccffcc] mt-1 line-clamp-2 leading-relaxed">
                    {e.body_new_content}
                  </p>
                )}
              </Link>
            ))
          )}
        </div>
      )}

      {/* Recent emails tab */}
      {tab === "recent" && (
        <div className="space-y-2">
          <div className="text-[#004d14] text-[11px] mb-3">
            // RECENT_EMAILS ({profile.recent_emails.length})
          </div>
          {profile.recent_emails.length === 0 ? (
            <div className="text-[#004d14] text-sm">no emails found</div>
          ) : (
            profile.recent_emails.map((e) => (
              <Link
                key={e.message_id}
                href={
                  e.thread_root_id
                    ? `/threads/${encodeURIComponent(e.thread_root_id)}`
                    : "#"
                }
                className="block retro-card p-3 hover:retro-card-active"
              >
                <div className="flex items-center gap-2">
                  {e.has_patch && (
                    <span className="text-[10px] border border-[#00ffff] text-[#00ffff] px-1 flex-shrink-0">
                      [PATCH{e.patch_version ? ` ${e.patch_version}` : ""}]
                    </span>
                  )}
                  <span className="text-[#00ff41] text-sm font-bold truncate">
                    {e.subject}
                  </span>
                </div>
                <div className="text-[10px] text-[#004d14] mt-1">
                  {formatDateShort(e.date)}
                </div>
                {e.body_new_content && (
                  <p className="text-[11px] text-[#ccffcc] mt-1 line-clamp-2 leading-relaxed">
                    {e.body_new_content}
                  </p>
                )}
              </Link>
            ))
          )}
        </div>
      )}
    </div>
  );
}
