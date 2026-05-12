// Server manager — owns the lifecycle of the spawned Next child.
//
// Responsibilities:
//   - Pick a port: prefer 3765, walk an ordered fallback list on EADDRINUSE.
//     Per the desktop plan, an ephemeral high port would orphan localStorage
//     on every restart, so the fallback list is short and deterministic.
//   - Spawn the child:
//       dev   : `node_modules/.bin/next dev --port <port>` from the project root
//       prod  : `node .next/standalone/server.js` with PORT env, cwd at the
//               standalone dir
//     Env is injected at spawn time only — there is no hot-swap.
//   - Poll `/api/internal/health` with the desktop token until ready.
//   - Expose `restart(envOverrides)` so the renderer's settings save can ask
//     for a managed restart instead of trying to mutate child env in place.
//
// Nothing in here imports `electron`; the module runs in main but stays
// dependency-free so it can be unit-tested with mocks.

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const net = require("node:net");
const { spawn } = require("node:child_process");
const http = require("node:http");

const { DEFAULT_PORT, FALLBACK_PORTS, FIXED_HOST } = require("./config.cjs");

const HEALTH_PATH = "/api/internal/health";
const DESKTOP_AUTH_HEADER = "x-weather-desktop-token";

function probePort(port) {
  return new Promise((resolve) => {
    const tester = net.createServer();
    tester.once("error", () => resolve(false));
    tester.once("listening", () => {
      tester.close(() => resolve(true));
    });
    tester.listen(port, FIXED_HOST);
  });
}

async function pickPort() {
  const candidates = [DEFAULT_PORT, ...FALLBACK_PORTS];
  for (const port of candidates) {
    // eslint-disable-next-line no-await-in-loop
    if (await probePort(port)) return port;
  }
  throw new Error(
    `All preferred ports busy (${candidates.join(", ")}). Refusing to fall back to an ephemeral port — that would orphan localStorage on every restart.`,
  );
}

function pollHealth(origin, token, { timeoutMs = 30_000, intervalMs = 250 } = {}) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const url = new URL(HEALTH_PATH, origin);
      const req = http.request(
        {
          hostname: url.hostname,
          port: url.port,
          path: url.pathname,
          method: "GET",
          headers: { [DESKTOP_AUTH_HEADER]: token },
        },
        (res) => {
          let body = "";
          res.on("data", (c) => (body += c));
          res.on("end", () => {
            if (res.statusCode === 200) {
              try {
                resolve(JSON.parse(body));
                return;
              } catch (e) {
                // fall through to retry
              }
            }
            if (Date.now() > deadline) {
              reject(new Error(`health check failed: status=${res.statusCode}`));
              return;
            }
            setTimeout(attempt, intervalMs);
          });
        },
      );
      req.on("error", () => {
        if (Date.now() > deadline) {
          reject(new Error("health check timed out before child became ready"));
          return;
        }
        setTimeout(attempt, intervalMs);
      });
      req.end();
    };
    attempt();
  });
}

function resolveDevNextBinary(projectRoot) {
  const local = path.join(projectRoot, "node_modules", ".bin", process.platform === "win32" ? "next.cmd" : "next");
  return fs.existsSync(local) ? local : null;
}

function resolveStandaloneServer(projectRoot) {
  // Next emits the standalone tree at `.next/standalone/`. The entrypoint is
  // `server.js` at the standalone root.
  return path.join(projectRoot, ".next", "standalone", "server.js");
}

function createServerManager({ projectRoot, mode, token, env, onExit }) {
  let child = null;
  let port = null;
  let origin = null;
  let currentEnv = { ...env };

  async function spawnChild() {
    port = await pickPort();
    currentEnv = { ...currentEnv, PORT: String(port), HOST: FIXED_HOST, DESKTOP_SESSION_TOKEN: token };
    origin = `http://${FIXED_HOST}:${port}`;

    if (mode === "dev") {
      const nextBin = resolveDevNextBinary(projectRoot);
      if (!nextBin) throw new Error(`server-manager: cannot find local next binary under ${projectRoot}/node_modules/.bin/`);
      child = spawn(nextBin, ["dev", "--port", String(port), "--hostname", FIXED_HOST], {
        cwd: projectRoot,
        env: currentEnv,
        stdio: "inherit",
      });
    } else {
      const serverJs = resolveStandaloneServer(projectRoot);
      if (!fs.existsSync(serverJs)) {
        throw new Error(`server-manager: standalone server.js not found at ${serverJs} — did you run \`next build\` and \`scripts/prepare-standalone.cjs\`?`);
      }
      // Run with system node (or ELECTRON_RUN_AS_NODE on the Electron binary
      // — main is expected to set NODE_RUNTIME accordingly before passing env
      // through). The standalone dir is the cwd, per Next's docs.
      const nodeBin = process.env.NODE_RUNTIME || "node";
      child = spawn(nodeBin, [serverJs], {
        cwd: path.dirname(serverJs),
        env: currentEnv,
        stdio: "inherit",
      });
    }

    child.once("exit", (code, signal) => {
      const wasRunning = child !== null;
      child = null;
      if (wasRunning && onExit) onExit({ code, signal });
    });
  }

  async function start() {
    await spawnChild();
    await pollHealth(origin, token);
    return { origin, port };
  }

  function kill() {
    if (!child) return;
    const c = child;
    child = null;
    try {
      c.kill("SIGTERM");
    } catch {
      /* ignore */
    }
  }

  async function restart(envOverrides) {
    currentEnv = { ...currentEnv, ...envOverrides };
    kill();
    // Wait for child to fully exit before spawning a fresh one — required so
    // the port can be reused without falling through to a fallback.
    await new Promise((r) => setTimeout(r, 250));
    return start();
  }

  return {
    start,
    kill,
    restart,
    get origin() {
      return origin;
    },
    get port() {
      return port;
    },
    get pid() {
      return child ? child.pid : null;
    },
  };
}

module.exports = {
  createServerManager,
  pickPort,
  pollHealth,
  // Exported for tests:
  __internal: { probePort, resolveDevNextBinary, resolveStandaloneServer },
};
