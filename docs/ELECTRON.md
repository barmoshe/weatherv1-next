# Electron Desktop

Single reference for the Electron shell — architecture, file map, pitfalls, and operational notes. Companion: [`ELECTRON_UXUI_RESEARCH.md`](ELECTRON_UXUI_RESEARCH.md) for renderer UX patterns.

## TL;DR

WeatherV1 runs a managed Next.js standalone child server inside an Electron shell. Four processes:

- **main** (`electron/main.cjs`) — Node; owns `BrowserWindow`, IPC, lifecycle, per-launch session token, auth-header injection, auto-updater wiring.
- **preload** (`electron/preload.cjs`) — isolated context; exposes a narrow `window.desktop` API via `contextBridge` (one wrapper per IPC channel).
- **renderer** — Next.js app loaded from `http://127.0.0.1:<port>`. Sandboxed; no Node, no `fs`. Cannot import from `src/server/*`.
- **Next child** — `fork()`-spawned `.next/standalone/server.js`. Plain Node process supervised by `electron/server-manager.cjs`.

Loopback host is **`127.0.0.1`** (not `localhost` — macOS may resolve to `::1`). Ports are deterministic: `3765` → `3766` → `3767` → `3768`, never ephemeral. The desktop perimeter is enforced by `src/proxy.ts` plus in-handler `assertDesktopAuth()` checks on every mutating route — defense in depth, because Server Actions can bypass the proxy matcher.

## File map

### Electron / packaging

| Path | Role |
| --- | --- |
| `electron/main.cjs` | Lifecycle, `BrowserWindow`, IPC handlers, session token gen, `webRequest.onBeforeSendHeaders` token injection, `update-electron-app`. `electron-squirrel-startup` short-circuit at top. |
| `electron/preload.cjs` | `contextBridge.exposeInMainWorld("desktop", ...)` matching `DesktopBridge`. One narrow wrapper per channel. |
| `electron/server-manager.cjs` | Port pick, dev/prod child spawn via the `fork()` wrapper (Electron Helper as Node — no second dock tile on macOS), health poll, `restart(env)`. |
| `electron/config.cjs` | `userData`-backed `settings.json`; `safeStorage` for API keys with plaintext fallback; env builder; session-token gen. Pure Node. |
| `electron/ffmpeg-verify.cjs` | env → bundled (`ffmpeg-static`/`ffprobe-static`) → PATH resolution; `app.asar` → `app.asar.unpacked` path rewrite. Returns structured `{ ok, errors, warnings, ... }`; never throws. |
| `forge.config.cjs` | Packager + `asarUnpack` for ffmpeg packages + `.next/standalone/**`, osxSign (`signatureFlags: "library"`), osxNotarize from env, macOS ZIP + Windows Squirrel makers, `@electron-forge/plugin-auto-unpack-natives`. |
| `build/entitlements.mac.plist` | Hardened-runtime entitlements: `allow-jit`, `disable-library-validation`, `allow-dyld-environment-variables`. Deliberately **not** `allow-unsigned-executable-memory`. |
| `scripts/prepare-standalone.cjs` | Copies `public/` + `.next/static/` into `.next/standalone/` after `next build` (Next omits both by design). |
| `scripts/run-electron.cjs` | Dev launcher; clears inherited `ELECTRON_RUN_AS_NODE` before spawning Electron. |

### Server-side desktop integration

| Path | Role |
| --- | --- |
| `src/server/runtime/config.ts` | Single source of truth for env-driven paths (workspace, runtime, ffmpeg, R2). Cached singleton + `resetRuntimeConfigForTests()`. |
| `src/server/runtime/paths.ts` | Derives uploads/outputs/cache/posters/previews/segment_posters from `runtimeDir`. |
| `src/server/runtime/auth.ts` | `DESKTOP_AUTH_HEADER`, `isDesktopMode()`, `isDesktopRequestAuthorized()`, `assertDesktopAuth(req)`. Uses `timingSafeEqual`. |
| `src/proxy.ts` | Token guard. Matchers: `/api/:path*`, `/outputs/:path*`, `/videos/:path*`. No-op outside desktop mode. |
| `src/app/api/internal/health/route.ts` | Boot probe for the Electron supervisor (auth-gated). |
| `src/app/api/desktop/status/route.ts` | Auth-gated status feed for the Settings panel. |
| `src/shared/desktop.ts` | `DesktopBridge` interface — contract between preload and renderer. |
| `src/types/desktop.d.ts` | `window.desktop` ambient declaration. |
| `src/client/lib/desktop.ts` | SSR-safe `window.desktop` access. |

## Don't regress these

1. **`import fs` from the renderer.** Doesn't work — sandbox + contextIsolation. Add an `ipcMain.handle("namespace:action", ...)` in main, expose a wrapper in `preload.cjs` under `window.desktop.action`, call from the renderer.
2. **Legacy IPC.** Codebase is 100% Promise-based `ipcMain.handle` + `ipcRenderer.invoke`. Zero `ipcMain.on` calls — keep it that way.
3. **Exposing `ipcRenderer` itself via `contextBridge`.** Defeats isolation entirely. Always expose one wrapper function per channel under `window.desktop`.
4. **`shell.openExternal(url)` without scheme + host validation.** Limit to `https:` URLs against a known allowlist.
5. **Substituting `localhost` for `127.0.0.1`.** macOS may resolve to `::1` while the child binds IPv4 only. `config.cjs` pins the host explicitly.
6. **`child_process.fork` instead of the existing `fork()` wrapper.** `server-manager.cjs` chooses between Electron-Helper-as-Node and plain `spawn(node)`. Going direct produces a duplicate macOS dock tile.
7. **Moving `ffmpeg-static` back inside `app.asar`.** Binaries can't be `exec`'d from inside the asar — they must be in `asarUnpack`. The `app.asar → app.asar.unpacked` path rewrite in `ffmpeg-verify.cjs` only works if the unpacked file exists.
8. **Storing API keys in renderer `localStorage`.** Use main-process `safeStorage`-backed config; the renderer saves keys via the `desktop:saveSettings` IPC channel.

## Token + perimeter model

The per-launch session token (32 random bytes, in-memory only, never persisted) is the entire desktop auth perimeter:

- Main generates and holds it; the renderer never sees it directly.
- Main's `session.webRequest.onBeforeSendHeaders` injects it on every loopback request from the renderer partition as `x-weather-desktop-token`.
- `src/proxy.ts` validates it at the perimeter; mutating handlers re-check via `assertDesktopAuth(req)` — Server Actions can bypass the proxy matcher.

Don't bypass, persist, or pass the token through preload.

## Sharp edges

1. **`turbopack.root: __dirname` in `next.config.ts` is mandatory.** Without it, Next infers the workspace root from a host repo's lockfile one level up and emits `.next/standalone/<host-subpath>/server.js`, silently breaking `server-manager.cjs`'s standalone resolution.
2. **Vitest must exclude `**/.next/**`.** `output: "standalone"` copies `src/test/**`; without the exclude, every test runs twice.
3. **`instrumentation.ts` is not the ffmpeg gate.** Under `node .next/standalone/server.js`, Next 16 silently skips `register()` ([vercel/next.js#89377](https://github.com/vercel/next.js/issues/89377)). The authoritative check is `electron/ffmpeg-verify.cjs`, run in main before the child spawns.
4. **`proxy.ts` is a perimeter, not a guarantee.** Server Actions POST to the route file that declares them, bypassing the matcher. Every mutating handler must call `assertDesktopAuth(req)` itself.
5. **ffmpeg/ffprobe can't run from inside `app.asar`.** Listed in `asarUnpack`; `ffmpeg-verify.cjs` rewrites the path at call time. On macOS the unpacked binary is re-signed under the host's Developer ID via `signatureFlags: "library"`.
6. **Auto-update needs signing on both platforms.** `update-electron-app` requires a signed `.app` on macOS *and* a signed Windows installer. No skip-signing path.
7. **Ports stay deterministic.** Never ephemeral — that would orphan `localStorage` on every restart. `BrowserWindow` is pinned to `session.fromPartition("persist:weatherv1")` so storage is keyed by partition, not origin, and survives port fallback.
8. **Settings changes restart the child.** No hot-swap of env. The renderer shows a "Reloading…" overlay until `/api/internal/health` returns green.
9. **`safeStorage` has a plaintext fallback.** On platforms without an OS keychain (headless Linux), `config.cjs` records `encryption: "none"`. Surface this in Settings so the user knows.
10. **`npm ci` needs `package-lock.json` to match `package.json`.** After any `package.json` dep change run `npm install --package-lock-only --ignore-scripts` and commit both files together.
11. **Some dev shells inherit `ELECTRON_RUN_AS_NODE=1`.** Raw `electron .` then makes `require("electron").app` undefined. Use `npm run electron:dev`, which clears the variable.

## Build and run

```bash
npm install                # one-time
npm run dev                # plain Next dev, no Electron
npm run electron:dev       # Electron + managed Next dev on 127.0.0.1:3765
npm run build && npm run standalone:prep    # produce the standalone tree
npm run electron:build     # …+ electron-forge package
npm run electron:make      # …+ electron-forge make (ZIP / Squirrel)
```

If `node_modules` is stale, `npm install` before `electron:*` scripts. New Electron requires are wrapped in try/catch so tests + `tsc` + `next build` work without it.

## Release path

`v*` tags trigger `.github/workflows/desktop.yml` (Windows-only matrix, Node 22, `electron-forge make --arch=x64`). `desktop-publish-release.yml` runs on the matching `workflow_run` and uploads **`WeatherV1-Setup.exe`** to Cloudflare R2 via the Worker, served at `https://<worker-host>/downloads/windows/latest/WeatherV1-Setup.exe` and the per-tag `…/windows/<tag>/…`. No asset is attached to the GitHub Release.

macOS is **not** built in CI — `WeatherV1-<ver>.zip` is produced locally on a developer Mac via `npm run electron:make` and shipped ad-hoc.

Signing:

- **Windows installers ship unsigned by design** — see `forge.config.cjs` header. Users see a one-time SmartScreen "unknown publisher" warning.
- **macOS** signing is operator-local only (the macOS zip is a local-build artifact, not CI-built): `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`, `OSX_SIGN_IDENTITY` exported from a developer Mac's `.env` for `npm run electron:make`.

Full procedure: [`RELEASE_CONVENTION.md`](RELEASE_CONVENTION.md). For a guided release, invoke the `weatherv1-release` skill.

## App icons

Source: `build/source-1024.png`. Outputs: `build/icon.icns` (`iconutil -c icns` from a 10-size `.iconset`) and `build/icon.ico` (6 sizes — 16/32/48/64/128/256 — via a Node ICO packer). `forge.config.cjs` references both via `packagerConfig.icon: "build/icon"`; the Squirrel maker uses `setupIcon: "build/icon.ico"`. `main.cjs` also sets `icon` on `BrowserWindow` for the dev-mode dock/taskbar.

To regenerate: drop a new 1024×1024 PNG into `build/source-1024.png`, recreate the `.iconset` with `sips -Z <size>` for each required size, run `iconutil -c icns`, and re-run the ICO packer.

## Electron 33→37 migration heads-ups

Currently on Electron 33+ (per `package.json`). When bumping major:

- **v33** deprecates `protocol.registerFileProtocol` → `protocol.handle()`. Not currently used.
- **v35** adds `registerPreloadScript()` replacing `setPreloads`. Affects only `setPreloads` callers — current code uses `webPreferences.preload`.
- **v36** lowercases `app.commandLine` switches. Project uses `process.argv` directly — unaffected.
- **v37** changes utility-process unhandled-rejection from crash to warn. Project uses `fork()`, not `utilityProcess`.
- **Don't pin below v34** — CVE-2025-5419 was backported there.

## Known follow-ups

Flag-only (separate tasks if you want to fix):

- **No Content-Security-Policy** is set on the BrowserWindow session. The renderer only loads from loopback today, so practical risk is low, but a strict CSP via `session.webRequest.onHeadersReceived` would harden against any future remote content load.
- **`shell.openExternal` in `main.cjs`** is called on the URL argument from `setWindowOpenHandler` without scheme/host validation. Tighten to `https:` only with a host allowlist.
- **`@electron/fuses` is not configured** in `forge.config.cjs`. Consider for production hardening: `OnlyLoadAppFromAsar`, `EnableEmbeddedAsarIntegrityValidation`, `RunAsNode` disable in packaged builds.

## R2 integration

The Electron app is where most users enter R2 gateway URL, tenant, bucket, and HTTP Basic Auth credentials. Flows live in `SettingsModal`, `StorageOnboardingGate`, and the desktop bridge types in `src/shared/desktop.ts`. For R2 architecture, conflict semantics, object-key layout (`tenantKey`), and Pulumi steps, see [`R2_PULUMI_HANDOFF.md`](R2_PULUMI_HANDOFF.md) and [`CLOUDFLARE_INTEGRATION.md`](CLOUDFLARE_INTEGRATION.md).
