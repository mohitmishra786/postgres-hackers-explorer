"use client";

import { useState, useRef, KeyboardEvent } from "react";

interface TerminalInputProps {
  onSubmit: (value: string) => void;
  placeholder?: string;
  loading?: boolean;
  className?: string;
  large?: boolean;
}

export default function TerminalInput({
  onSubmit,
  placeholder = "type your query...",
  loading = false,
  className = "",
  large = false,
}: TerminalInputProps) {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && value.trim() && !loading) {
      onSubmit(value.trim());
    }
  };

  return (
    <div
      className={`flex items-center gap-2 retro-input px-3 py-2 ${large ? "text-base" : "text-sm"} ${className}`}
      onClick={() => inputRef.current?.focus()}
    >
      {/* Prompt */}
      <span className="text-[#004d14] flex-shrink-0 select-none">
        pghackers.com &gt;
      </span>

      {/* Input */}
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={loading}
        className={`
          flex-1 bg-transparent border-none outline-none font-mono
          text-[#00ff41] placeholder-[#004d14] caret-[#00ff41]
          disabled:opacity-50
          ${large ? "text-base" : "text-sm"}
        `}
        autoComplete="off"
        spellCheck={false}
      />

      {/* Submit button or loading indicator */}
      {loading ? (
        <span className="text-[#004d14] text-xs flex-shrink-0">
          <span className="text-[#00ff41] animate-pulse">■■■</span>
        </span>
      ) : value.trim() ? (
        <button
          onClick={() => onSubmit(value.trim())}
          className="text-[#004d14] text-xs flex-shrink-0 hover:text-[#00ff41] transition-colors"
        >
          [enter]
        </button>
      ) : null}
    </div>
  );
}
