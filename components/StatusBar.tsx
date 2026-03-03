"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { formatRelativeDate } from "@/lib/utils";

interface Stats {
  total_emails: number;
  total_threads: number;
  total_patches: number;
  date_end: string | null;
}

export default function StatusBar() {
  const pathname = usePathname();
  const [stats, setStats] = useState<Stats | null>(null);
  const [time, setTime] = useState("");

  useEffect(() => {
    // Fetch stats on mount
    fetch("/api/stats")
      .then((r) => r.json())
      .then(setStats)
      .catch(() => null);
  }, []);

  useEffect(() => {
    // Live clock
    const tick = () => {
      setTime(
        new Date().toISOString().replace("T", " ").substring(0, 19) + " UTC"
      );
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, []);

  const formatNum = (n: number) => n.toLocaleString();

  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-50 flex items-center justify-between px-4 py-1 text-[11px] font-mono border-t border-[#1a2e1a] bg-[#0a0a0a]"
      style={{ color: "#004d14" }}
    >
      {/* Left: connection + stats */}
      <div className="flex items-center gap-4 overflow-hidden">
        <span className="text-[#00ff41]">[connected]</span>
        {stats ? (
          <>
            <span>
              emails:{" "}
              <span className="text-[#00cc33]">
                {formatNum(stats.total_emails)}
              </span>
            </span>
            <span className="hidden sm:inline">
              threads:{" "}
              <span className="text-[#00cc33]">
                {formatNum(stats.total_threads)}
              </span>
            </span>
            <span className="hidden md:inline">
              patches:{" "}
              <span className="text-[#00cc33]">
                {formatNum(stats.total_patches)}
              </span>
            </span>
            {stats.date_end && (
              <span className="hidden lg:inline">
                last sync:{" "}
                <span className="text-[#00cc33]">
                  {formatRelativeDate(stats.date_end)}
                </span>
              </span>
            )}
          </>
        ) : (
          <span className="text-[#004d14]">loading stats...</span>
        )}
      </div>

      {/* Center: current route */}
      <div className="hidden md:block text-[#004d14]">
        route: <span className="text-[#00cc33]">{pathname}</span>
      </div>

      {/* Right: clock */}
      <div className="text-[#004d14] hidden sm:block">{time}</div>
    </div>
  );
}
