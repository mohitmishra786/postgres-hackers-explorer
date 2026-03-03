"use client";

import { useState } from "react";
import { Patch } from "@/lib/db";
import { formatDate } from "@/lib/utils";
import CodeBlock from "./CodeBlock";

interface PatchViewerProps {
  patches: Patch[];
}

export default function PatchViewer({ patches }: PatchViewerProps) {
  const [selectedPatch, setSelectedPatch] = useState(patches[0]?.id ?? null);

  if (patches.length === 0) {
    return (
      <div className="text-[#004d14] text-sm text-center py-4">
        no patches found for this thread
      </div>
    );
  }

  const activePatch = patches.find((p) => p.id === selectedPatch) ?? patches[0];

  return (
    <div className="space-y-3">
      {/* Patch version tabs */}
      {patches.length > 1 && (
        <div className="flex gap-1 flex-wrap">
          {patches.map((patch) => (
            <button
              key={patch.id}
              onClick={() => setSelectedPatch(patch.id)}
              className={`
                text-[11px] font-mono px-2 py-1 border transition-all
                ${
                  selectedPatch === patch.id
                    ? "border-[#00ff41] text-[#00ff41] bg-[#004d14]"
                    : "border-[#1a2e1a] text-[#004d14] hover:border-[#004d14] hover:text-[#00cc33]"
                }
              `}
            >
              {patch.version ?? "v1"}
              {patch.filename && (
                <span className="text-[10px] ml-1 opacity-60">
                  {patch.filename.split("/").pop()}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Active patch metadata */}
      {activePatch && (
        <div className="border border-[#1a2e1a] bg-[#0d0d0d]">
          <div className="flex items-center gap-4 px-3 py-2 border-b border-[#1a2e1a] text-[11px]">
            <span className="text-[#004d14]">
              version: <span className="text-[#00cc33]">{activePatch.version ?? "v1"}</span>
            </span>
            {activePatch.author_name && (
              <span className="text-[#004d14]">
                by: <span className="text-[#00cc33]">[{activePatch.author_name}]</span>
              </span>
            )}
            {activePatch.submitted_at && (
              <span className="text-[#004d14]">
                {formatDate(activePatch.submitted_at)}
              </span>
            )}
            {activePatch.diff_stats && (
              <div className="ml-auto flex gap-2">
                <span className="text-[#00ff41]">
                  +{activePatch.diff_stats.lines_added}
                </span>
                <span className="text-[#ff4444]">
                  -{activePatch.diff_stats.lines_removed}
                </span>
                <span className="text-[#004d14]">
                  {activePatch.diff_stats.files_changed} file
                  {activePatch.diff_stats.files_changed !== 1 ? "s" : ""}
                </span>
              </div>
            )}
          </div>

          {/* Diff content */}
          {activePatch.content ? (
            <CodeBlock
              code={activePatch.content}
              isDiff={true}
              filename={activePatch.filename ?? undefined}
              maxLines={300}
            />
          ) : (
            <div className="p-4 text-[#004d14] text-sm text-center">
              [patch content not stored — view in original email]
            </div>
          )}
        </div>
      )}
    </div>
  );
}
