# Electron Desktop Handoff

This is the "what's running, what's left, where the landmines are" doc for whoever picks up the work next. The architecture / design contract lives in `ELECTRON_DESKTOP_PLAN.md`; this doc is the operational handoff.

## TL;DR

Steps 1–6 of the plan are landed. The runtime/auth/asset boundary is done, every mutating route is gated, the Electron shell scaffold is in place, and the Forge packaging config (sign/notarize/makers) is written. Tests + typecheck + `next build` all pass on the host. **The Electron app has not been launched yet** because the Electron + Forge + ffmpeg packages aren't installed — `package.json` pins them but `npm install` hasn't been run with the new deps.

Steps 7–9 remain: desktop-aware UI wiring (renderer side), the test suite for runtime/auth/server-manager, and the desktop CI workflow.

## Snapshot

- Project root: `/Users/barmoshe/claude-creative-stack/weatherv1-next` (child repo with its own `.git`)
- Stack: Next 16.2.6 (App Router, `proxy.ts` is the renamed middleware), React 19.2.4, Vitest 2.x
- Local toolchain on the host: Node 20.19 by default, Node 22 LTS available via `npx node@22`. `next build` works fine on Node 20; Electron 33 ships its own Node 22 anyway.
- Latest verified state: `tsc --noEmit` clean, `npm test` 43/43, `next build` emits `.next/standalone/server.js`, `scripts/prepare-standalone.cjs` populates the standalone tree.

## How to run things

```
npm install            # one-time: materializes the new electron / forge / ffmpeg deps
npx tsc --noEmit       # typecheck
npm test               # vitest, 43 tests across 5 files
npm run dev            # plain Next dev (no Electron)
node_modules/.bin/next build && node scripts/prepare-standalone.cjs  # produce the standalone tree
npm run electron:dev   # Electron + next dev (needs `npm install` to have run)
npm run electron:build # next build + standalone:prep + electron-forge package
npm run electron:make  # …+ electron-forge make (ZIP / Squirrel installers)
```

Until you run `npm install`, the new Electron requires won't resolve and `electron:*` scripts can't run. Everything else works as-is because the new requires in `electron/main.cjs` (`update-electron-app`, `electron-squirrel-startup`) are wrapped in try/catch.

## File map

Backend / runtime:

| Path | Role |
| --- | --- |
| `src/server/runtime/config.ts` | Single source of truth for env-driven paths (workspace, runtime, ffmpeg, bg music). Cached singleton + `resetRuntimeConfigForTests()`. |
| `src/server/runtime/paths.ts` | Derives uploads/outputs/cache/posters/previews/segment_posters from `runtimeDir`. |
| `src/server/runtime/auth.ts` | `DESKTOP_AUTH_HEADER`, `isDesktopMode()`, `isDesktopRequestAuthorized()`, `assertDesktopAuth(req)` (returns `NextResponse \| null`). `timingSafeEqual` for the comparison. |
| `src/server/assets/source.ts` | `LocalWorkspaceAssetSource` (provider interface ready for a future `GoogleDriveAssetSource`). Cached singleton + reset hook. |
| `src/proxy.ts` | Token guard. Matchers: `/api/:path*`, `/outputs/:path*`, `/videos/:path*`. No-ops outside desktop mode. |
| `src/app/api/internal/health/route.ts` | Boot probe for the Electron supervisor. Auth-gated; returns workspace + ffmpeg readiness. |
| `src/app/api/desktop/status/route.ts` | Auth-gated GET surfacing runtime/workspace/key state to the (future) settings UI. |
| `src/shared/desktop.ts` | `DesktopBridge` interface — the contract between preload and renderer. |
| `src/types/desktop.d.ts` | `Window.desktop` ambient declaration. |

Electron / packaging:

| Path | Role |
| --- | --- |
| `electron/main.cjs` | Lifecycle: ffmpeg verify → session token gen → env build → spawn → health poll → BrowserWindow pinned to `persist:weatherv1` → `webRequest.onBeforeSendHeaders` token injection → `desktop:*` IPC handlers → `update-electron-app` for packaged builds. `electron-squirrel-startup` short-circuit at the top. |
| `electron/preload.cjs` | `contextBridge.exposeInMainWorld("desktop", { ... })` matching `DesktopBridge`. |
| `electron/server-manager.cjs` | Port pick (3765 → 3766 → 3767 → 3768; never ephemeral), dev/prod spawn, `pollHealth(origin, token)`, `restart(env)`. Pure-Node; no electron import. |
| `electron/config.cjs` | userData-backed `settings.json`; `safeStorage` for API keys with documented plaintext fallback; env builder; session-token generator. Pure-Node API; electron objects passed in as args. |
| `electron/ffmpeg-verify.cjs` | env → bundled → PATH resolution; `app.asar` → `app.asar.unpacked` rewrite; structured `{ ok, ffmpegPath, ffprobePath, ffmpegSource, ffprobeSource, errors, warnings }`; never throws. |
| `forge.config.cjs` | Packager + `asarUnpack` for ffmpeg packages + `.next/standalone/**`; osxSign (with `signatureFlags: "library"` for nested binaries); osxNotarize from env; makers (ZIP + Squirrel); auto-unpack-natives plugin; commented GitHub publisher. |
| `build/entitlements.mac.plist` | Hardened-runtime entitlements. Includes `allow-jit`, `disable-library-validation`, `allow-dyld-environment-variables`. Explicitly NOT `allow-unsigned-executable-memory`. |
| `scripts/prepare-standalone.cjs` | Copies `public/` and `.next/static/` into `.next/standalone/` after `next build`. |

Config / lockfile-adjacent:

| Path | Role |
| --- | --- |
| `next.config.ts` | `output: "standalone"` + `turbopack.root: __dirname` (mandatory — see Sharp Edges). Existing `/outputs` / `/videos` rewrites kept. |
| `vitest.config.ts` | Excludes `**/.next/**` (mandatory — see Sharp Edges). |
| `package.json` | `"main": "electron/main.cjs"`. Pins `electron@^33`, `@electron-forge/cli@^7` + 4 forge sub-packages, `ffmpeg-static@^5`, `ffprobe-static@^3`, `update-electron-app@^3`, `electron-squirrel-startup@^1`. New scripts: `standalone:prep`, `electron:dev`, `electron:build`, `electron:make`. |
| `instrumentation.ts` | Soft (warning-only, dev-only) ffmpeg check for `next dev` parity. Skipped when `DESKTOP_MODE=1`. **Not** the authoritative ffmpeg gate. |

## Sharp edges

1. **`turbopack.root` must be pinned.** The host repo (`claude-creative-stack`) has its own `package-lock.json` one level above this project. Without `turbopack: { root: __dirname }` in `next.config.ts`, Next infers the workspace root from that lockfile and emits `.next/standalone/claude-creative-stack/weatherv1-next/server.js` — breaking `electron/server-manager.cjs`'s standalone resolution. Don't remove the pin.
2. **Vitest must exclude `.next`.** `output: "standalone"` copies `src/test/**` into the standalone tree. Without `exclude: [..., "**/.next/**"]`, every test runs twice and `npm test` reports 86 tests instead of 43.
3. **`instrumentation.ts` is not the ffmpeg gate.** Under `node .next/standalone/server.js`, Next 16 silently skips `register()` (vercel/next.js#89377). The authoritative ffmpeg check lives in `electron/ffmpeg-verify.cjs` and runs in Electron main *before* the child spawns. Don't move it into the Next side.
4. **Proxy is a perimeter, not a guarantee.** Server Actions in Next 16 POST to the route file that declares them. A new Server Action introduced in a route without proxy coverage would bypass the perimeter. Every mutating handler must call `assertDesktopAuth(req)` itself.
5. **ffmpeg/ffprobe can't run from inside `app.asar`.** `forge.config.cjs` lists them in `asarUnpack`; `electron/ffmpeg-verify.cjs` rewrites paths at call time. The unpacked binaries must be re-signed under the host's Developer ID on macOS — the `signatureFlags: "library"` setting in `osxSign` handles that.
6. **Auto-update needs signing on both platforms.** `update-electron-app` is wired in `main.cjs` but it requires a signed `.app` on macOS *and* a signed Windows installer. There is no skip-signing-ship-updates path. Don't promise an auto-update demo before signing is wired in CI.
7. **Ports stay deterministic.** The server-manager tries 3765 → 3766 → 3767 → 3768 only. Never an ephemeral high port — that would orphan `localStorage` on every restart. The BrowserWindow is pinned to `session.fromPartition("persist:weatherv1")` so storage is keyed by partition, not origin, and survives port fallback.
8. **Settings changes restart the child.** No hot-swap of env in the running Next child. `electron/server-manager.cjs` exposes `restart(env)`; the renderer is expected to show a "Reloading…" overlay until `/api/internal/health` returns green.
9. **`safeStorage` has a plaintext fallback.** On platforms without an OS keychain (typically headless Linux without a keyring), `electron/config.cjs` records `encryption: "none"` and stores the key as plaintext. The settings UI should surface this so the user knows.

## Remaining work

### Step 7 — Desktop-aware UI

Renderer-only changes. Routes already accept the desktop JSON shape; preload bridge already exposes the right surface.

- `src/client/components/studio/SettingsModal.tsx` — show workspace path + validation, ffmpeg status, OpenAI/Gemini key presence, app version, updater state. Save button calls `window.desktop.saveSettings(...)`; show a "Reloading…" overlay until `/api/internal/health` is green.
- `src/client/components/studio/UploadCard.tsx` — prefer `window.desktop.pickAudioFile()` when the bridge exists, then POST `{ desktop_file_path }` JSON to `/api/transcribe`. Fall back to the current multipart flow otherwise.
- `src/client/components/catalog/CatalogPanel.tsx` — prefer `window.desktop.importCatalogVideo()`, then POST `{ desktop_file_path, metadata }` JSON to `/api/catalog/videos`.
- Add a small `src/client/lib/desktop.ts` helper so SSR access stays safe.

### Step 8 — Tests

See the plan doc for the full suggested list. Suggested files: `runtime-config.test.ts`, `asset-source.test.ts`, `desktop-auth.test.ts`, `proxy.test.ts`, `server-manager.test.ts`, `prepare-standalone.test.ts`. The server-manager test is the most involved — mock `child_process.spawn` and `http.request`, exercise the EADDRINUSE fallback, the health-poll loop, and `restart(env)`.

### Step 9 — Desktop CI

`.github/workflows/desktop.yml` matrix on `macos-latest` + `windows-latest`:

- PR CI: install → typecheck → test → unsigned `electron-forge package`. Upload artifacts.
- Release CI (tag push): same, plus secrets for signing/notarization (`APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`, `WIN_CERT_FILE`, `WIN_CERT_PASSWORD`), then `electron-forge publish` once the GitHub publisher block in `forge.config.cjs` is uncommented.

## Verification checklist for the next pass

- [x] `npm test` 43/43
- [x] `tsc --noEmit` clean
- [x] `next build` produces `.next/standalone/server.js` at the correct path
- [x] `scripts/prepare-standalone.cjs` populates `public/` + `.next/static/`
- [x] `electron/ffmpeg-verify.cjs` returns `{ ok: true }` against system ffmpeg
- [x] `forge.config.cjs` loads cleanly
- [ ] `npm install` succeeds with the new pins (untested — defer to the next agent)
- [ ] `npm run electron:dev` boots, Settings modal opens
- [ ] Audio upload via native picker round-trips
- [ ] Catalog video import via native picker round-trips
- [ ] Render pipeline runs end to end with a user-chosen workspace
- [ ] `npm run electron:make` produces signed artifacts in CI

## Stop point

After Step 6. The Electron shell + Forge packaging config are complete on paper; nothing has actually been launched in Electron because dependencies aren't installed. The first runnable smoke test for the next agent is `npm install && npm run electron:dev`. The first packaging smoke test is `npm run electron:make` — which will be unsigned locally and signed only on CI with the secrets above.
