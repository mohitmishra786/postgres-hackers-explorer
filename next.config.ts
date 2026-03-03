import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @neondatabase/serverless uses the 'ws' package in Node.js runtime.
  // Mark it as external so Next.js doesn't try to bundle it.
  serverExternalPackages: ["@neondatabase/serverless"],

  images: {
    remotePatterns: [],
  },
};

export default nextConfig;
