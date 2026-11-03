#!/usr/bin/env node
// Serves a folder for the browser build's end-to-end tests (see
// web/runtime/http-folder.ts): GET reads, PUT writes, DELETE removes,
// GET /__manifest.json lists every file. CORS is open because the page runs
// from file:// (Origin: null). Test use only; binds 127.0.0.1.
//
//   node web/test/folder-server.mjs <folder> [port]

import fs from "node:fs";
import http from "node:http";
import path from "node:path";

const root = path.resolve(process.argv[2] ?? ".");
const port = Number(process.argv[3] ?? 8765);

function walk(dir, prefix = "") {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...walk(path.join(dir, e.name), rel));
    else out.push(rel);
  }
  return out;
}

function safePath(urlPath) {
  const rel = decodeURIComponent(urlPath).replace(/^\/+/, "");
  const abs = path.resolve(root, rel);
  if (abs !== root && !abs.startsWith(root + path.sep)) throw new Error("outside root");
  return abs;
}

http
  .createServer((req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, PUT, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "*");
    if (req.method === "OPTIONS") return res.end();
    const url = new URL(req.url, "http://x");
    try {
      if (url.pathname === "/__manifest.json") {
        res.setHeader("Content-Type", "application/json");
        const files = walk(root);
        const sizes = Object.fromEntries(files.map((f) => [f, fs.statSync(path.join(root, f)).size]));
        return res.end(JSON.stringify({ files, sizes }));
      }
      const abs = safePath(url.pathname);
      if (req.method === "GET") {
        if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
          res.statusCode = 404;
          return res.end();
        }
        return fs.createReadStream(abs).pipe(res);
      }
      if (req.method === "PUT") {
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        const out = fs.createWriteStream(abs);
        req.pipe(out);
        out.on("finish", () => res.end());
        return;
      }
      if (req.method === "DELETE") {
        fs.rmSync(abs, { recursive: true, force: true });
        return res.end();
      }
      res.statusCode = 405;
      res.end();
    } catch (err) {
      res.statusCode = 400;
      res.end(String(err));
    }
  })
  .listen(port, "127.0.0.1", () => console.log(`folder-server ${root} on http://127.0.0.1:${port}/`));
