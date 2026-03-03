"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { EmailNode } from "@/lib/db";
import { formatDate } from "@/lib/utils";
import EmailBody from "./EmailBody";

interface ThreadTreeProps {
  nodes: EmailNode[];
  depth?: number;
  maxDepth?: number;
}

interface ThreadNodeProps {
  node: EmailNode;
  depth: number;
  maxDepth: number;
  isLast: boolean;
  prefix: string;
}

function ThreadNode({ node, depth, maxDepth, isLast, prefix }: ThreadNodeProps) {
  const [expanded, setExpanded] = useState(depth < 2);
  const [bodyVisible, setBodyVisible] = useState(depth < 1);
  const hasChildren = node.children.length > 0;

  const connector = isLast ? "└── " : "├── ";
  const childPrefix = prefix + (isLast ? "    " : "│   ");

  return (
    <div className="font-mono text-sm">
      {/* Node header */}
      <div className="flex items-start gap-1">
        <span className="tree-line flex-shrink-0 text-[#004d14] text-[12px]">
          {prefix}{connector}
        </span>
        <div className="flex-1 min-w-0">
          {/* Author + date + patch badge */}
          <button
            className="flex items-center gap-2 flex-wrap text-left w-full hover:bg-[#0a1a0a] px-1 py-0.5 rounded-none transition-colors"
            onClick={() => setBodyVisible(!bodyVisible)}
          >
            <span className="text-[#00cc33] font-bold">
              [{node.author_name ?? "unknown"}]
            </span>
            <span className="text-[#004d14] text-[11px]">
              {formatDate(node.date)}
            </span>
            {node.has_patch && (
              <span className="text-[10px] border border-[#00ffff] text-[#00ffff] px-1">
                [PATCH{node.patch_version ? ` ${node.patch_version}` : ""}]
              </span>
            )}
            {hasChildren && (
              <span className="text-[10px] text-[#004d14] ml-auto">
                {bodyVisible ? "▼" : "▶"} {node.children.length} repl{node.children.length === 1 ? "y" : "ies"}
              </span>
            )}
          </button>

          {/* Email body */}
          <AnimatePresence>
            {bodyVisible && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.15 }}
                className="overflow-hidden"
              >
                <div className="mt-2 mb-3 pl-2 border-l border-[#1a2e1a]">
                  <EmailBody email={node} showMeta={false} />
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Children */}
          {hasChildren && (
            <div className="mt-1">
              {depth >= maxDepth ? (
                <button
                  onClick={() => setExpanded(!expanded)}
                  className="text-[11px] text-[#004d14] hover:text-[#00cc33] transition-colors pl-4"
                >
                  {expanded
                    ? "[collapse]"
                    : `[nested ${node.children.length} more level${node.children.length > 1 ? "s" : ""}]`}
                </button>
              ) : null}

              {(depth < maxDepth || expanded) && (
                <ThreadTree
                  nodes={node.children}
                  depth={depth + 1}
                  maxDepth={maxDepth}
                  prefix={childPrefix}
                />
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

interface TreeProps {
  nodes: EmailNode[];
  depth?: number;
  maxDepth?: number;
  prefix?: string;
}

export default function ThreadTree({
  nodes,
  depth = 0,
  maxDepth = 5,
  prefix = "",
}: TreeProps) {
  return (
    <div className="space-y-0">
      {nodes.map((node, i) => (
        <ThreadNode
          key={node.message_id}
          node={node}
          depth={depth}
          maxDepth={maxDepth}
          isLast={i === nodes.length - 1}
          prefix={prefix}
        />
      ))}
    </div>
  );
}
