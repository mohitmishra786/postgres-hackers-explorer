"use client";

import { motion, AnimatePresence } from "framer-motion";

interface RetroLoaderProps {
  lines?: string[];
  className?: string;
}

const DEFAULT_LINES = [
  "> connecting to archive...",
  "> fetching email index...",
  "> loading thread data...",
];

export default function RetroLoader({
  lines = DEFAULT_LINES,
  className = "",
}: RetroLoaderProps) {
  return (
    <div className={`font-mono text-sm text-[#00cc33] space-y-1 ${className}`}>
      {lines.map((line, i) => (
        <motion.div
          key={i}
          initial={{ opacity: 0, x: -10 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: i * 0.3, duration: 0.2 }}
          className="flex items-center gap-2"
        >
          <span>{line}</span>
          {i === lines.length - 1 && (
            <span className="blink text-[#00ff41]">_</span>
          )}
        </motion.div>
      ))}
    </div>
  );
}

/**
 * Inline spinner — three dots pulsing in sequence.
 */
export function RetroSpinner({ label = "loading" }: { label?: string }) {
  return (
    <div className="flex items-center gap-1 text-[#00cc33] text-sm font-mono">
      <span className="text-[#004d14]">&gt;</span>
      <span>{label}</span>
      <span className="inline-flex gap-px">
        {[0, 1, 2].map((i) => (
          <motion.span
            key={i}
            className="text-[#00ff41]"
            animate={{ opacity: [0.2, 1, 0.2] }}
            transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.2 }}
          >
            .
          </motion.span>
        ))}
      </span>
    </div>
  );
}
