import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // instrumentation.ts is auto-detected in Next.js 15 (no experimental flag needed)
  // Serve rendered videos and plan bundles from runtime/
  async rewrites() {
    return [
      {
        source: "/outputs/:filename",
        destination: "/api/outputs/:filename",
      },
      {
        source: "/videos/:filename",
        destination: "/api/videos/:filename",
      },
    ];
  },
};

export default nextConfig;
