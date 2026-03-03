import type { Metadata } from "next";
import "./globals.css";
import Sidebar from "@/components/Sidebar";
import StatusBar from "@/components/StatusBar";
import ScanlineOverlay from "@/components/ScanlineOverlay";

export const metadata: Metadata = {
  title: "pghackers.dev — PostgreSQL Hackers Explorer",
  description:
    "AI-powered reader and explorer for the pgsql-hackers mailing list archive. Browse threads, patches, and ask questions with RAG.",
  keywords: [
    "postgresql",
    "pgsql-hackers",
    "mailing list",
    "postgres",
    "patches",
    "commitfest",
  ],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:ital,wght@0,100..800;1,100..800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="bg-[#0a0a0a] text-[#ccffcc] font-mono antialiased">
        <ScanlineOverlay />

        <div className="flex min-h-screen">
          {/* Sidebar */}
          <Sidebar />

          {/* Main content */}
          <main className="flex-1 overflow-auto pb-8">
            {children}
          </main>
        </div>

        {/* Fixed status bar */}
        <StatusBar />
      </body>
    </html>
  );
}
