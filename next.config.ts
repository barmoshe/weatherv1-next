import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // `standalone` lets Electron main run `node .next/standalone/server.js` as
  // a managed child without dragging in the full repo. Next omits `public/`
  // and `.next/static/` from the standalone tree by design — see
  // `scripts/prepare-standalone.cjs` for the copy step. Custom-server +
  // standalone is mutually exclusive in Next 16; Electron is *not* a custom
  // server in the Next sense, it's an external supervisor.
  output: "standalone",

  // instrumentation.ts is auto-detected in Next.js 16 (no experimental flag needed)
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
