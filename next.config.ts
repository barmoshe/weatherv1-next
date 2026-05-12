import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // `standalone` lets Electron main run `node .next/standalone/server.js` as
  // a managed child without dragging in the full repo. Next omits `public/`
  // and `.next/static/` from the standalone tree by design — see
  // `scripts/prepare-standalone.cjs` for the copy step. Custom-server +
  // standalone is mutually exclusive in Next 16; Electron is *not* a custom
  // server in the Next sense, it's an external supervisor.
  output: "standalone",

  // Pin Next's tracing root to this project. Without this, Next auto-detects
  // the workspace root by walking up looking for lockfiles, and lands on the
  // host repo's package-lock.json one level up — which lands the standalone
  // tree at `.next/standalone/<host-subpath>/server.js` instead of
  // `.next/standalone/server.js`. That breaks `electron/server-manager.cjs`'s
  // standalone resolution.
  turbopack: {
    root: __dirname,
  },

  // `@huggingface/transformers` ships an `onnxruntime-node` import for the
  // Node entry. Webpack must not bundle that native module — keep it as an
  // external require. `sharp` is the same shape (optional image preprocessor
  // that some pipelines pull in).
  serverExternalPackages: ["@huggingface/transformers", "onnxruntime-node", "sharp", "wavefile"],
  webpack: (config, { isServer }) => {
    if (!isServer) {
      // Belt-and-suspenders for any code path that ends up traced into the
      // client bundle (none currently — the provider is server-only — but
      // this matches the upstream transformers.js Next.js recipe).
      config.resolve = config.resolve || {};
      config.resolve.alias = {
        ...(config.resolve.alias || {}),
        "onnxruntime-node$": false,
        sharp$: false,
      };
    }
    return config;
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
