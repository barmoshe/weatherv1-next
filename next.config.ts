import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // `standalone` lets Electron main run `node .next/standalone/server.js` as
  // a managed child without dragging in the full repo. Next omits `public/`
  // and `.next/static/` from the standalone tree by design — see
  // `scripts/prepare-standalone.cjs` for the copy step. Custom-server +
  // standalone is mutually exclusive in Next 16; Electron is *not* a custom
  // server in the Next sense, it's an external supervisor.
  output: "standalone",

  // archiver (+ its zip-stream/compress-commons/lazystream deps) is a
  // CommonJS, server-only library with dynamic requires that don't survive
  // Turbopack's ESM bundling (the default export disappears). Keep it external
  // so it's required at runtime from the standalone node_modules (NFT traces
  // it in). Used only by the Premiere-export route.
  serverExternalPackages: ["archiver"],

  // Do not ship dev `runtime/jobs.json` into traced standalone (Electron still
  // prefers userData `WEATHER_RUNTIME_DIR`; this avoids seeding installers).
  // Key must match picomatch against `next-server` — see Next's collect-build-traces.
  outputFileTracingExcludes: {
    // Keep build/runtime artifacts out of the traced standalone tree. Dynamic
    // fs use in src/server/ffmpeg/binaries.ts makes Next trace the whole
    // project root, which otherwise sweeps `out/` (prior packaged apps, incl. a
    // multi-GB make zip) and `runtime/` (dev media + cache, ~770MB) into
    // `.next/standalone` — bloating and breaking electron-forge packaging. The
    // standalone server trace is keyed under "next-server"; a "*" key does NOT
    // apply to it, so the excludes are repeated there with `**/` globs.
    "*": ["**/out/**", "**/runtime/**", "**/docs/**", "**/coverage/**"],
    "next-server": ["**/out/**", "**/runtime/**", "**/docs/**", "**/coverage/**"],
  },

  // Pin Next's tracing root to this project. Without this, Next auto-detects
  // the workspace root by walking up looking for lockfiles, and lands on the
  // host repo's package-lock.json one level up — which lands the standalone
  // tree at `.next/standalone/<host-subpath>/server.js` instead of
  // `.next/standalone/server.js`. That breaks `electron/server-manager.cjs`'s
  // standalone resolution.
  turbopack: {
    root: __dirname,
  },

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
