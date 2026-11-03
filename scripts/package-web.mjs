#!/usr/bin/env node
// Packs the browser build into the zip editors get:
//
//   WeatherV1/
//     WeatherV1.html            the whole app (web/dist/index.html)
//     START-HERE.md             the setup prompt the editor's own Claude follows
//     CLAUDE.md                 points Claude Code at START-HERE.md
//     README-HE.txt             one paragraph for a human
//     onboarding/onboarding.html  the illustrated steps Claude shows along the way
//
// Writes out/web/WeatherV1-Web.zip and out/web/version.json (the page's
// "newer version" check reads the published copy). Run after `npm run web:build`.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { zipSync, strToU8 } from "fflate";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { version } = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const dist = path.join(root, "web", "dist", "index.html");
const onboarding = path.join(root, "web", "onboarding");
const outDir = path.join(root, "out", "web");

if (!fs.existsSync(dist)) {
  console.error("[package-web] web/dist/index.html is missing; run `npm run web:build` first");
  process.exit(1);
}

const read = (p) => new Uint8Array(fs.readFileSync(p));
const files = {
  "WeatherV1/WeatherV1.html": read(dist),
  "WeatherV1/START-HERE.md": read(path.join(onboarding, "START-HERE.md")),
  "WeatherV1/CLAUDE.md": read(path.join(onboarding, "CLAUDE.md")),
  "WeatherV1/README-HE.txt": read(path.join(onboarding, "README-HE.txt")),
  "WeatherV1/onboarding/onboarding.html": read(path.join(onboarding, "onboarding.html")),
  "WeatherV1/VERSION.txt": strToU8(`${version}\n`),
};

fs.mkdirSync(outDir, { recursive: true });
const zip = zipSync(files, { level: 9, mtime: new Date() });
fs.writeFileSync(path.join(outDir, "WeatherV1-Web.zip"), zip);
fs.writeFileSync(path.join(outDir, "version.json"), JSON.stringify({ version }) + "\n");
console.log(`[package-web] out/web/WeatherV1-Web.zip (${(zip.length / 1e6).toFixed(1)} MB), version ${version}`);
