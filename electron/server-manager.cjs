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
const { spawn, fork } = require("node:child_process");
const http = require("node:http");

const { DEFAULT_PORT, FALLBACK_PORTS, FIXED_HOST } = require("./config.cjs");

const HEALTH_PATH = "/api/internal/health";
const DESKTOP_AUTH_HEADER = "x-weather-desktop-token";
const DEFAULT_HEALTH_TIMEOUT_MS = 90_000;

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

function readLogTail(logPath, maxChars = 4000) {
  if (!logPath || !fs.existsSync(logPath)) return "";
  try {
    const content = fs.readFileSync(logPath, "utf8");
    return content.slice(-maxChars).trim();
  } catch {
    return "";
  }
}

function formatDiagnostic(logPath) {
  const tail = readLogTail(logPath);
  return tail ? `\n\nLast child log lines:\n${tail}` : "";
}

function appendLogLine(logPath, source, chunk) {
  if (!logPath || !chunk) return;
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  const text = chunk.toString();
  fs.appendFileSync(logPath, text.replace(/^/gm, `[${source}] `), "utf8");
}

function pollHealth(origin, token, { timeoutMs = DEFAULT_HEALTH_TIMEOUT_MS, intervalMs = 250, getDiagnostic } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastFailure = "connection refused";
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
              const detail = body ? ` body=${body.slice(0, 500)}` : "";
              reject(new Error(`health check failed: status=${res.statusCode}${detail}${getDiagnostic ? getDiagnostic() : ""}`));
              return;
            }
            lastFailure = `status=${res.statusCode}`;
            setTimeout(attempt, intervalMs);
          });
        },
      );
      req.on("error", () => {
        if (Date.now() > deadline) {
          reject(new Error(`health check timed out before child became ready (${lastFailure})${getDiagnostic ? getDiagnostic() : ""}`));
          return;
        }
        setTimeout(attempt, intervalMs);
      });
      req.setTimeout(5000, () => {
        lastFailure = "request timed out";
        req.destroy();
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
  return path.join(unpackAsarPath(projectRoot), ".next", "standalone", "server.js");
}

function unpackAsarPath(p) {
  if (typeof p !== "string" || !p) return p;
  return p.replace(/([\/\\])app\.asar([\/\\]?)/, "$1app.asar.unpacked$2");
}

function resolveNodeRuntime() {
  if (process.env.NODE_RUNTIME) {
    return { command: process.env.NODE_RUNTIME, env: {} };
  }
  if (process.versions && process.versions.electron && process.execPath) {
    return { command: process.execPath, env: { ELECTRON_RUN_AS_NODE: "1" } };
  }
  return { command: "node", env: {} };
}

// Prefer fork() when the manager is itself running inside Electron's main
// process. spawn(process.execPath, ...) with ELECTRON_RUN_AS_NODE=1 launches
// the *main* app bundle a second time, which on macOS produces a separate,
// bouncing "exec" dock tile. fork() routes through the Electron Helper bundle
// (LSUIElement=true in its Info.plist), so no extra dock icon appears, and
// fork() automatically sets ELECTRON_RUN_AS_NODE=1 for us. An explicit
// NODE_RUNTIME override still wins so tests / external Node setups can opt
// out.
function shouldUseElectronFork() {
  if (process.env.NODE_RUNTIME) return false;
  return Boolean(process.versions && process.versions.electron);
}

function createServerManager({ projectRoot, mode, token, env, onExit, logPath }) {
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
      const cwd = path.dirname(serverJs);
      let spawnCommand;
      if (shouldUseElectronFork()) {
        // fork() under Electron uses the Helper bundle (LSUIElement=true), so
        // the child does not get its own Dock entry. The standalone dir is
        // the cwd, per Next's docs.
        child = fork(serverJs, [], {
          cwd,
          env: currentEnv,
          stdio: logPath
            ? ["ignore", "pipe", "pipe", "ipc"]
            : ["inherit", "inherit", "inherit", "ipc"],
        });
        spawnCommand = `fork(${process.execPath})`;
      } else {
        // Run with system node (or whatever NODE_RUNTIME points at). Used in
        // tests and any non-Electron host. The standalone dir is the cwd,
        // per Next's docs.
        const nodeRuntime = resolveNodeRuntime();
        child = spawn(nodeRuntime.command, [serverJs], {
          cwd,
          env: { ...currentEnv, ...nodeRuntime.env },
          stdio: logPath ? ["ignore", "pipe", "pipe"] : "inherit",
        });
        spawnCommand = nodeRuntime.command;
      }
      if (logPath) {
        fs.mkdirSync(path.dirname(logPath), { recursive: true });
        fs.writeFileSync(logPath, `[main] spawned ${spawnCommand} ${serverJs}\n[main] cwd=${cwd}\n`, "utf8");
        child.stdout?.on("data", (chunk) => appendLogLine(logPath, "stdout", chunk));
        child.stderr?.on("data", (chunk) => appendLogLine(logPath, "stderr", chunk));
      }
    }

    child.once("exit", (code, signal) => {
      const wasRunning = child !== null;
      child = null;
      if (wasRunning && onExit) onExit({ code, signal });
    });
  }

  async function start() {
    await spawnChild();
    const childAtStart = child;
    await Promise.race([
      pollHealth(origin, token, {
        getDiagnostic: () => formatDiagnostic(logPath),
      }),
      new Promise((_, reject) => {
        if (!childAtStart) return;
        childAtStart.once("exit", (code, signal) => {
          reject(
            new Error(
              `Next child exited before health check succeeded (code=${code} signal=${signal})${formatDiagnostic(logPath)}`,
            ),
          );
        });
        childAtStart.once("error", (err) => {
          reject(new Error(`Next child failed to spawn: ${err && err.message ? err.message : String(err)}${formatDiagnostic(logPath)}`));
        });
      }),
    ]);
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
  __internal: {
    probePort,
    resolveDevNextBinary,
    unpackAsarPath,
    resolveNodeRuntime,
    resolveStandaloneServer,
    readLogTail,
    shouldUseElectronFork,
  },
};
