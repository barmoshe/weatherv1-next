# Electron Agent Guide

For AI agents working in `electron/` and adjacent code. This is the mental
model and routine-pitfall map. The security baseline lives in
[`AGENTS.md`](../AGENTS.md) "Safety Rules"; the design rationale lives in
[`ELECTRON_DESKTOP_PLAN.md`](ELECTRON_DESKTOP_PLAN.md); the current operational
state lives in [`ELECTRON_DESKTOP_HANDOFF.md`](ELECTRON_DESKTOP_HANDOFF.md).
This file is the *Claude-facing* complement to those.

## Process model

Three processes, three responsibilities:

- **main** (`electron/main.cjs`) — Node, full filesystem, owns `BrowserWindow`
  + app lifecycle + IPC handlers + the per-launch session token + the auth
  interceptor that injects the token on loopback requests. Talks to the
  spawned Next child only through `server-manager.cjs`.
- **preload** (`electron/preload.cjs`) — runs before renderer scripts in an
  isolated context. The *only* place the renderer can reach IPC. Exposes a
  narrow `window.desktop` API via `contextBridge.exposeInMainWorld`.
- **renderer** — the Next.js app loaded from `http://127.0.0.1:<port>`. No
  Node, no `fs`, no `require`. Cannot import from `src/server/*` — that runs
  only inside the bundled Next child server (a separate Node process).

The Next child server itself is a fourth process, but it is a Node process,
not an Electron process — treat it as a regular Next runtime.

## Files to read before editing `electron/`

| File | Role | Key facts |
| --- | --- | --- |
| [`electron/main.cjs`](../electron/main.cjs) | Lifecycle, BrowserWindow creation, IPC wiring, auto-updater | `BrowserWindow` at line 183; security flags at 197-199; auth interceptor at 158-171; 8 `ipcMain.handle` channels |
| [`electron/preload.cjs`](../electron/preload.cjs) | `window.desktop` API surface | One `contextBridge.exposeInMainWorld("desktop", ...)` at line 25; 8 narrow wrappers (lines 14-23), one per channel |
| [`electron/server-manager.cjs`](../electron/server-manager.cjs) | Spawns/restarts Next child via `fork()`, redirects stdio to log | `fork(serverJs, ...)` at line 199; `shouldUseElectronFork()` at line 164; `SIGTERM` shutdown at line 263 |
| [`electron/config.cjs`](../electron/config.cjs) | Settings, key encryption via `safeStorage`, env block for child | `FIXED_HOST = "127.0.0.1"` at line 24; `DEFAULT_PORT = 3765` + `FALLBACK_PORTS = [3766, 3767, 3768]` at lines 21-22 |
| [`forge.config.cjs`](../forge.config.cjs) | Packaging, asar.unpack, signing, makers | `asar.unpack` glob at lines 73-74 (ffmpeg-static, ffprobe-static, full standalone tree) |

## Routine pitfalls Claude gets wrong

These are grounded in the current implementation. Each is something the code
*already* does correctly — the rule is "don't regress it."

1. **`import fs` from the renderer.** Doesn't work — sandbox + contextIsolation.
   Add an `ipcMain.handle("namespace:action", ...)` in main, expose a wrapper
   in `preload.cjs` under `window.desktop.action`, call from the renderer.

2. **Legacy IPC (`ipcMain.on` / `ipcRenderer.send`).** The codebase is fully
   on Promise-based `ipcMain.handle` + `ipcRenderer.invoke`. New channels
   must follow that pattern. There are zero `ipcMain.on` calls anywhere —
   keep it that way.

3. **Exposing `ipcRenderer` itself via `contextBridge`.** Defeats the
   isolation boundary entirely. Always expose **one wrapper function per
   channel** under `window.desktop`. See `preload.cjs:14-23` for the shape.

4. **`shell.openExternal(url)` without scheme + host validation.** Limit to
   `https:` URLs against a known allowlist (project docs, GitHub releases,
   etc.). See "Known follow-ups" below — `main.cjs:207` is currently
   unguarded and a tightening target.

5. **Substituting `localhost` for `127.0.0.1`.** macOS may resolve `localhost`
   to `::1` (IPv6) while the Next child binds to IPv4 only. `config.cjs:24`
   fixes the host explicitly. Renderer fetches, IPC paths, and probes must
   all use the same `FIXED_HOST` value.

6. **Using `child_process.fork` instead of the existing `fork()` wrapper.**
   `server-manager.cjs:164-167` chooses between `fork()` (Electron Helper
   bundle, no extra dock icon on macOS) and `spawn(node, ...)` (non-Electron
   hosts and tests). Going direct to `child_process.fork` or `spawn(process.execPath, ...)`
   spawns a second main app instance on macOS, producing a bouncing dock tile.

7. **Moving `ffmpeg-static` back inside `app.asar`.** `forge.config.cjs:73-74`
   unpacks `ffmpeg-static`, `ffprobe-static`, and the full `.next/standalone`
   tree. Spawning a binary from inside the asar archive `ENOTDIR`s — the asar
   is a tarball-like single file, not a directory. The `app.asar → app.asar.unpacked`
   path rewrite in `ffmpeg-verify.cjs` only works if the unpacked file exists.

8. **Storing API keys in renderer `localStorage`.** Use main-process
   `safeStorage`-backed config (`config.cjs:144-152`). The renderer never
   touches keys directly — it asks main to save them via the
   `desktop:saveSettings` IPC channel, which encrypts before writing.

## Token + perimeter model

The desktop session token (`main.cjs:110`, generated per launch, 32 bytes,
never persisted) is the entire desktop auth perimeter. Three places matter:

- **Main generates and holds it.** The renderer never sees the token.
- **Main's `session.webRequest.onBeforeSendHeaders` injects it** on every
  loopback request from the renderer partition (`main.cjs:163-169`). Token
  goes in the `x-weather-desktop-token` header.
- **The Next child validates it** in `src/proxy.ts` *and* in each mutating
  handler — `proxy.ts` is the perimeter; in-handler checks are defense in
  depth.

Do not bypass any of these layers. Do not persist the token. Do not pass it
through preload.

## Known follow-ups (flag-only — not fixed in docs work)

These are real but unaddressed in the current docs improvement; spin off
separate tasks if you want to fix them.

- **No Content-Security-Policy** is set on the BrowserWindow session. A
  strict CSP via `session.webRequest.onHeadersReceived` would harden against
  injection if the renderer ever loaded remote content. Right now the
  renderer only loads from `http://127.0.0.1:<port>`, so the practical risk
  is low, but the defensive posture is incomplete.
- **`shell.openExternal` at `electron/main.cjs:207`** is called on the URL
  argument from `setWindowOpenHandler` without validation. Tighten to
  `https:` only, optionally with a host allowlist. The second call at
  `main.cjs:278` is a hardcoded `ms-settings:appsfeatures` URI and is safe.
- **`@electron/fuses` is not configured** in `forge.config.cjs`. Consider
  for production hardening: `OnlyLoadAppFromAsar`,
  `EnableEmbeddedAsarIntegrityValidation`, `RunAsNode` disable in packaged
  builds.

## Version notes (Electron 33→37 migration heads-ups)

This project is on Electron 33+ (per `package.json`). When bumping major:

- **v33** deprecates `protocol.registerFileProtocol` → use `protocol.handle()`
  + `url.pathToFileURL()`. Not currently used here, so the bump is free.
- **v35** adds `registerPreloadScript()` replacing `setPreloads`. Affects only
  preload registration patterns, not the current `webPreferences.preload`
  setup.
- **v36** lowercases `app.commandLine` switches — only affects
  `app.commandLine.getSwitchValue` callers. This project uses `process.argv`
  directly, so unaffected.
- **v37** changes utility-process unhandled-rejection behavior from crash to
  warn. Not currently using `utilityProcess` (uses `fork()` instead).
- **Don't pin below v34** — CVE-2025-5419 was backported there. v33 is
  acceptable for the moment but should be bumped to v34+ at the next
  convenient release.
