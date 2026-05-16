#!/usr/bin/env node
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import chokidar from "chokidar";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const port = Number(process.env.DOWNLOAD_PAGE_PORT || 8080);
const buildScript = path.join(__dirname, "build-download-page.mjs");

function runBuild() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [buildScript], {
      cwd: root,
      stdio: "inherit",
    });
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`build exited ${code}`))));
  });
}

async function main() {
  await runBuild();

  const watchPaths = [
    path.join(root, "docs/download-page/index.html.template"),
    path.join(root, "docs/download-page/assets"),
  ];

  let rebuildTimer;
  chokidar.watch(watchPaths, { ignoreInitial: true }).on("all", () => {
    clearTimeout(rebuildTimer);
    rebuildTimer = setTimeout(() => {
      runBuild().catch((err) => console.error("[download-page:dev]", err.message));
    }, 120);
  });

  const liveServerBin = path.join(
    root,
    "node_modules",
    "live-server",
    "live-server.js"
  );

  console.log(`[download-page:dev] http://127.0.0.1:${port}/ (serving _site/)`);

  const server = spawn(
    process.execPath,
    [liveServerBin, "_site", "--port=" + String(port), "--no-browser", "--wait=120"],
    { cwd: root, stdio: "inherit" }
  );

  server.on("exit", (code) => process.exit(code ?? 0));

  const shutdown = () => {
    server.kill("SIGTERM");
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("[download-page:dev]", err);
  process.exit(1);
});
