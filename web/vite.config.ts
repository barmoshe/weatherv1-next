// Browser-only build: the whole app (UI + the Next API routes + the pipeline)
// as one self-contained web/dist/index.html that runs from file://.
//
// - `@/…` resolves to src/ as in Next.
// - Node built-ins and server-only packages resolve to web/shims/.
// - Any file at web/swap/<path> replaces src/<path> (ffmpeg, whisper.cpp and
//   file serving get browser implementations; everything else is reused).
// - vite-plugin-singlefile inlines JS + CSS; workers are imported with
//   `?worker&inline`, so nothing is loaded from a sibling file (file:// pages
//   can't fetch their neighbours).

import fs from "node:fs";
import path from "node:path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";

const WEB = __dirname;
const SRC = path.resolve(WEB, "../src");
const SHIMS = path.join(WEB, "shims");
const pkg = JSON.parse(fs.readFileSync(path.resolve(WEB, "../package.json"), "utf8")) as { version: string };

function swapServerModules(): Plugin {
  return {
    name: "weatherv1-swap",
    enforce: "pre",
    async resolveId(source, importer, options) {
      if (!importer || source.startsWith("\0")) return null;
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
      if (!resolved || !resolved.id.startsWith(SRC)) return null;
      const swap = path.join(WEB, "swap", path.relative(SRC, resolved.id));
      return fs.existsSync(swap) ? swap : null;
    },
  };
}

// Vite replaces `process.env` with `{}` in browser builds, but the server code
// reads its configuration from env at call time (paths, keys, desktop mode).
// Our own sources read the live object the page fills in instead
// (web/runtime/settings.ts `applyEnv`). node_modules keep Vite's handling.
function liveProcessEnv(): Plugin {
  const own = [SRC, WEB].map((d) => `${d}/`);
  return {
    name: "weatherv1-live-env",
    enforce: "pre",
    transform(code, id) {
      if (!own.some((d) => id.startsWith(d)) || !code.includes("process.env")) return null;
      return { code: code.replace(/\bprocess\.env\b/g, "globalThis.__WV1_ENV__"), map: null };
    },
  };
}

// ONNX Runtime references its ~28 MB .wasm with `new URL(file, import.meta.url)`;
// inlined, it would be base64'd into the worker and again into the page. Load
// it from jsDelivr instead (pinned to the installed version, CORS open), the
// same place transformers.js fetches it from by default.
function ortWasmFromCdn(): Plugin {
  const ver = JSON.parse(
    fs.readFileSync(path.resolve(WEB, "../node_modules/onnxruntime-web/package.json"), "utf8"),
  ) as { version: string };
  const cdn = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ver.version}/dist/`;
  return {
    name: "weatherv1-ort-wasm-cdn",
    enforce: "pre",
    transform(code, id) {
      if (!id.includes("onnxruntime-web") || !code.includes("new URL(\"ort-wasm")) return null;
      return {
        code: code.replace(/new URL\("(ort-wasm[^"]+)",\s*import\.meta\.url\)/g, (_m, file) => `new URL("${cdn}${file}")`),
        map: null,
      };
    },
  };
}

const shim = (name: string) => path.join(SHIMS, name);

export default defineConfig({
  root: WEB,
  base: "./",
  plugins: [liveProcessEnv(), ortWasmFromCdn(), swapServerModules(), react(), viteSingleFile({ removeViteModuleLoader: true })],
  define: {
    __WEATHERV1_VERSION__: JSON.stringify(pkg.version),
  },
  resolve: {
    alias: [
      { find: /^@\//, replacement: `${SRC}/` },
      { find: "next/server", replacement: shim("next-server.ts") },
      { find: "next/navigation", replacement: shim("next-navigation.ts") },
      { find: /^(node:)?fs\/promises$/, replacement: shim("fs-promises.ts") },
      { find: /^(node:)?fs$/, replacement: shim("fs.ts") },
      { find: /^(node:)?path$/, replacement: "path-browserify" },
      { find: /^(node:)?crypto$/, replacement: shim("crypto.ts") },
      { find: /^(node:)?os$/, replacement: shim("os.ts") },
      { find: /^(node:)?util$/, replacement: shim("util.ts") },
      { find: /^(node:)?stream$/, replacement: shim("stream.ts") },
      { find: /^(node:)?child_process$/, replacement: shim("child_process.ts") },
      { find: /^(node:)?module$/, replacement: shim("module.ts") },
      { find: /^(node:)?buffer$/, replacement: "buffer" },
      { find: /^(node:)?events$/, replacement: "events" },
      { find: /^(node:)?url$/, replacement: shim("url.ts") },
      { find: "proper-lockfile", replacement: shim("proper-lockfile.ts") },
      { find: "argon2", replacement: shim("empty.ts") },
    ],
  },
  // Classic (IIFE) workers: Chrome won't start a *module* worker from a blob URL
  // on a file:// page (opaque origin), but runs classic ones fine.
  worker: { format: "iife", plugins: () => [ortWasmFromCdn()] },
  build: {
    outDir: path.join(WEB, "dist"),
    emptyOutDir: true,
    target: "es2022",
    assetsInlineLimit: Number.MAX_SAFE_INTEGER,
    cssCodeSplit: false,
    chunkSizeWarningLimit: 20_000,
  },
});
