"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";

const NAV_ITEMS = [
  { href: "/threads", label: "threads", icon: ">" },
  { href: "/search", label: "search", icon: ">" },
  { href: "/ask", label: "ask", icon: ">" },
  { href: "/patches", label: "patches", icon: ">" },
  { href: "/authors", label: "authors", icon: ">" },
];

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-56 min-h-screen flex flex-col border-r border-[#1a2e1a] bg-[#0d0d0d]">
      {/* Logo */}
      <div className="p-4 border-b border-[#1a2e1a]">
        <Link href="/" className="block">
          <div className="text-[#00ff41] font-bold text-lg leading-tight">
            pghackers
            <span className="text-[#004d14]">.dev</span>
          </div>
          <div className="text-[11px] text-[#004d14] mt-1">
            pgsql-hackers explorer
            <span className="blink text-[#00ff41]">_</span>
          </div>
        </Link>
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-4 px-2 space-y-1">
        {NAV_ITEMS.map((item) => {
          const isActive =
            pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`
                flex items-center gap-2 px-3 py-2 text-sm transition-all duration-100
                ${
                  isActive
                    ? "text-[#00ff41] bg-[#004d14] border-l-2 border-[#00ff41]"
                    : "text-[#00cc33] hover:text-[#00ff41] hover:bg-[#0a1a0a] border-l-2 border-transparent"
                }
              `}
            >
              <span className={isActive ? "text-[#00ff41]" : "text-[#004d14]"}>
                {item.icon}
              </span>
              <span className="font-mono">{item.label}</span>
              {isActive && (
                <motion.span
                  className="ml-auto text-[#00ff41] text-xs"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                >
                  ●
                </motion.span>
              )}
            </Link>
          );
        })}
      </nav>

      {/* Bottom section */}
      <div className="p-4 border-t border-[#1a2e1a]">
        <div className="text-[10px] text-[#004d14] space-y-1">
          <div>archive: lists.postgresql.org</div>
          <div>list: pgsql-hackers</div>
          <a
            href="https://github.com/mohitmishra786/postgres-hackers-explorer"
            target="_blank"
            rel="noopener noreferrer"
            className="block text-[#004d14] hover:text-[#00cc33] transition-colors"
          >
            [source code]
          </a>
        </div>
      </div>
    </aside>
  );
}
