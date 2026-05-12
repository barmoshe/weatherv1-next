#!/usr/bin/env node
// After `next build` with `output: "standalone"`, Next emits a self-contained
// server at `.next/standalone/server.js` but deliberately omits both
// `public/` and `.next/static/`. This script copies them in so the
// standalone tree is actually runnable.
//
// Run after `next build`:
//   node scripts/prepare-standalone.cjs
//
// Idempotent: re-running is safe; existing files are replaced.

"use strict";

const fs = require("node:fs");
const path = require("node:path");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const STANDALONE_DIR = path.join(PROJECT_ROOT, ".next", "standalone");

function copyDir(src, dest) {
  if (!fs.existsSync(src)) {
    console.warn(`[prepare-standalone] skipping ${src}: does not exist`);
    return;
  }
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(s, d);
    } else if (entry.isSymbolicLink()) {
      const link = fs.readlinkSync(s);
      try {
        fs.unlinkSync(d);
      } catch {
        /* ignore */
      }
      fs.symlinkSync(link, d);
    } else {
      fs.copyFileSync(s, d);
    }
  }
}

function main() {
  if (!fs.existsSync(STANDALONE_DIR)) {
    console.error(
      `[prepare-standalone] ${STANDALONE_DIR} not found. Run \`next build\` first (and confirm \`output: "standalone"\` is set in next.config.ts).`,
    );
    process.exit(1);
  }

  const publicSrc = path.join(PROJECT_ROOT, "public");
  const publicDst = path.join(STANDALONE_DIR, "public");
  console.log(`[prepare-standalone] copy ${publicSrc} -> ${publicDst}`);
  copyDir(publicSrc, publicDst);

  const staticSrc = path.join(PROJECT_ROOT, ".next", "static");
  const staticDst = path.join(STANDALONE_DIR, ".next", "static");
  console.log(`[prepare-standalone] copy ${staticSrc} -> ${staticDst}`);
  copyDir(staticSrc, staticDst);

  // Native deps required by the local Whisper provider. Next.js standalone
  // tracing copies the JS surface of `@huggingface/transformers` but can
  // miss `onnxruntime-node`'s platform-specific `.node`/`.dylib`/`.dll`
  // siblings (they're loaded via dynamic require at runtime). Copy the full
  // package directories so packaging is deterministic across OSes.
  const nativeModules = [
    "@huggingface/transformers",
    "onnxruntime-node",
    "wavefile",
  ];
  for (const mod of nativeModules) {
    const src = path.join(PROJECT_ROOT, "node_modules", mod);
    const dst = path.join(STANDALONE_DIR, "node_modules", mod);
    if (!fs.existsSync(src)) {
      console.warn(`[prepare-standalone] ${mod} not installed; skipping native copy`);
      continue;
    }
    console.log(`[prepare-standalone] copy ${src} -> ${dst}`);
    copyDir(src, dst);
  }

  console.log("[prepare-standalone] done");
}

main();
