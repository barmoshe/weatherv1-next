#!/usr/bin/env node
// Drives the built web/dist/index.html from file:// in real Chrome (the way an
// editor opens it), with the library served by folder-server.mjs.
//
//   node web/test/e2e.mjs <library-folder> <out-dir> [step...]
//
// Steps run in order; each writes a screenshot to <out-dir>. Without steps it
// only boots the app and opens every tab. Console errors fail the run.

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright";

const here = path.dirname(fileURLToPath(import.meta.url));
const [library, outDir, ...steps] = process.argv.slice(2);
if (!library || !outDir) {
  console.error("usage: e2e.mjs <library-folder> <out-dir> [step...]");
  process.exit(2);
}
fs.mkdirSync(outDir, { recursive: true });

const port = 8800 + Math.floor(Math.random() * 100);
const server = spawn(process.execPath, [path.join(here, "folder-server.mjs"), library, String(port)], { stdio: "inherit" });
await new Promise((r) => setTimeout(r, 500));

const page_url = `${pathToFileURL(path.join(here, "../dist/index.html")).href}?testFolder=${encodeURIComponent(`http://127.0.0.1:${port}/`)}`;
const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--enable-unsafe-webgpu"] });
const page = await browser.newPage({ viewport: { width: 1470, height: 832 } });
const errors = [];
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
  if (process.env.E2E_VERBOSE) console.log(`[page:${m.type()}] ${m.text()}`);
});
page.on("pageerror", (e) => errors.push(String(e)));

const shot = (name) => page.screenshot({ path: path.join(outDir, `${name}.png`) });
const t0 = Date.now();
const log = (msg) => console.log(`[e2e +${((Date.now() - t0) / 1000).toFixed(1)}s] ${msg}`);

try {
  await page.goto(page_url);
  await page.waitForSelector("#panel-studio, [data-tab-panel='studio']", { timeout: 60_000 });
  log("studio mounted");
  await shot("01-studio");
  for (const tab of ["jobs", "catalog", "analytics"]) {
    await page.click(`#tab-${tab}`);
    await page.waitForTimeout(tab === "catalog" ? 4000 : 800);
    await shot(`02-tab-${tab}`);
    log(`tab ${tab}`);
  }
  await page.click("#tab-studio");

  for (const step of steps) {
    const mod = await import(pathToFileURL(path.join(here, "steps", `${step}.mjs`)).href);
    log(`step ${step}`);
    await mod.default({ page, shot, log, library, outDir });
  }
} catch (err) {
  errors.push(`driver: ${err instanceof Error ? err.message : String(err)}`);
  await shot("zz-failure").catch(() => undefined);
} finally {
  await browser.close();
  server.kill();
}

const relevant = errors.filter((e) => !/favicon|ERR_FILE_NOT_FOUND/.test(e));
if (relevant.length) {
  console.error(`[e2e] ${relevant.length} error(s):\n${relevant.join("\n")}`);
  process.exit(1);
}
log("ok");
