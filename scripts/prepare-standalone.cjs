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

// Full transitive dependency closure of a top-level package, read from the
// project's (hoisted) node_modules.
function packageClosure(rootName) {
  const nm = path.join(PROJECT_ROOT, "node_modules");
  const seen = new Set();
  const stack = [rootName];
  while (stack.length) {
    const name = stack.pop();
    if (seen.has(name)) continue;
    seen.add(name);
    let pj;
    try {
      pj = JSON.parse(fs.readFileSync(path.join(nm, name, "package.json"), "utf8"));
    } catch {
      continue; // not hoisted at top level / not installed — skip
    }
    for (const dep of Object.keys(pj.dependencies || {})) {
      if (!seen.has(dep)) stack.push(dep);
    }
  }
  return [...seen];
}

// `serverExternalPackages` keeps a CommonJS lib out of the Turbopack bundle, but
// the Turbopack build does NOT trace its transitive deps into the standalone
// node_modules (e.g. archiver → is-stream/teex/bare-* go missing → the export
// route 500s with MODULE_NOT_FOUND). Copy the whole closure in here so the
// runtime `require()` resolves. Bundler-agnostic and idempotent.
function ensureBundledDeps(rootName) {
  const srcNM = path.join(PROJECT_ROOT, "node_modules");
  const dstNM = path.join(STANDALONE_DIR, "node_modules");
  let copied = 0;
  const closure = packageClosure(rootName);
  for (const name of closure) {
    const src = path.join(srcNM, name);
    const dst = path.join(dstNM, name);
    if (!fs.existsSync(src) || fs.existsSync(dst)) continue;
    copyDir(src, dst);
    copied++;
  }
  console.log(
    `[prepare-standalone] ensured ${rootName} deps in standalone (${copied} copied / ${closure.length} in closure)`,
  );
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

  // Externalized server-only CJS packages whose transitive deps Turbopack
  // doesn't trace into the standalone tree (see ensureBundledDeps).
  ensureBundledDeps("archiver");

  console.log("[prepare-standalone] done");
}

main();
