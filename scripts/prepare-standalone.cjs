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
  // siblings (they're loaded via dynamic require at runtime).
  //
  // We copy selectively: transformers.js's `src/` and `types/` trees are
  // dev-only and have 80-char nested paths (model class folders) that blow
  // past Windows MAX_PATH = 260 chars once nested inside the Squirrel
  // staging dir during installer creation. Only `dist/` and the package
  // manifest are needed at runtime.
  const nativeCopies = [
    {
      mod: "@huggingface/transformers",
      // Skip `src/` and `types/` — runtime uses dist/transformers.node.cjs.
      includeRoot: ["dist", "package.json", "LICENSE", "README.md"],
    },
    { mod: "onnxruntime-node" },
    { mod: "wavefile" },
  ];
  for (const entry of nativeCopies) {
    const src = path.join(PROJECT_ROOT, "node_modules", entry.mod);
    const dst = path.join(STANDALONE_DIR, "node_modules", entry.mod);
    if (!fs.existsSync(src)) {
      console.warn(`[prepare-standalone] ${entry.mod} not installed; skipping native copy`);
      continue;
    }
    if (entry.includeRoot) {
      fs.mkdirSync(dst, { recursive: true });
      for (const name of entry.includeRoot) {
        const childSrc = path.join(src, name);
        const childDst = path.join(dst, name);
        if (!fs.existsSync(childSrc)) continue;
        console.log(`[prepare-standalone] copy ${childSrc} -> ${childDst}`);
        const stat = fs.statSync(childSrc);
        if (stat.isDirectory()) copyDir(childSrc, childDst);
        else fs.copyFileSync(childSrc, childDst);
      }
    } else {
      console.log(`[prepare-standalone] copy ${src} -> ${dst}`);
      copyDir(src, dst);
    }
  }

  console.log("[prepare-standalone] done");
}

main();
