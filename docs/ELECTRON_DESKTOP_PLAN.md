# Electron Desktop Plan For `weatherv1-next`

## Summary

- Build a real local desktop app, not a static export.
- Keep the current Next.js App Router UI and `/api/*` flows.
- Run the app inside Electron with a bundled local Next server.
- Target `macOS + Windows` first.
- Keep assets local in v1, but isolate asset access behind a provider boundary so Google Drive can replace the local source later.

## Repo Facts Driving The Design

- The app is `Next 16.2.6` with the App Router and route handlers in `src/app/api/**`.
- The app depends on local filesystem state and an in-process worker:
  - `instrumentation.ts`
  - `src/server/jobs/worker.ts`
  - `src/server/jobs/store.ts`
  - `src/server/jobs/plan-bundle.ts`
- The app shells out to FFmpeg/FFprobe:
  - `src/server/ffmpeg/binaries.ts`
  - `src/server/ffmpeg/probe.ts`
  - `src/server/ffmpeg/renderer.ts`
- The current server still assumes repo-relative paths:
  - `src/server/catalog/storage.ts`
  - `src/server/ffmpeg/renderer.ts`
- The current settings UI is minimal and only shows catalog health:
  - `src/client/components/studio/SettingsModal.tsx`
- Upload and catalog import are browser-style today:
  - `src/client/components/studio/UploadCard.tsx`
  - `src/client/components/catalog/CatalogPanel.tsx`

## Architecture

### 1. Desktop Shell

- Add Electron as the desktop shell. Target Electron 33+ (ships Node 22.x for main/renderer).
- Use `Electron Forge` (officially aligned with Electron's first-party `@electron/osx-sign` and `@electron/notarize`).
- Raise the **host** toolchain baseline to `Node 22 LTS` for `next build`. The packaged app then has two Node runtimes: Electron's bundled Node for main/renderer, and the spawned Next standalone child. Run the child with system `node` (or with `ELECTRON_RUN_AS_NODE=1` on the Electron binary) so the runtime serving `/api/*` is unambiguous.
- If delta updates or staged rollouts later become a requirement, revisit `electron-builder` + `electron-updater`. Forge's `update-electron-app` implements neither.

### 2. Local Next Server

- Keep Next as the app UI and API backend.
- Enable `output: "standalone"` in `next.config.ts`. Next's "standalone" output and Next's "custom server" feature are mutually exclusive — Electron main is **not** a custom server in the Next sense, it is an external supervisor that owns the child's lifecycle.
- After `next build`, copy `public/` and `.next/static/` into `.next/standalone/`. Next omits both from the standalone tree by design; the copy step lives in `scripts/prepare-standalone.cjs` and runs as part of the desktop build.
- In packaged Electron builds, launch the generated standalone `server.js` as a managed local child process:
  - Explicit `cwd` set to the standalone dir.
  - Env vars injected from Electron config at spawn (workspace, runtime, ffmpeg paths, API keys, desktop session token).
  - System `node` (or `ELECTRON_RUN_AS_NODE=1`) as the executable.
- In dev Electron builds, launch `next dev` as the managed child process so HMR still works.
- Existing `next.config.ts` rewrites (`/outputs/*` and `/videos/*` → `/api/`) must keep working under standalone. Any new tracing options (`outputFileTracingIncludes`, etc.) needed for sibling assets are unnecessary in v1 because user media lives in `WEATHER_WORKSPACE_DIR`, not under the bundled app.

### 3. Fixed Local Origin

- Use one fixed loopback origin such as `http://127.0.0.1:3765`.
- Keep the origin stable so browser `localStorage` and `IndexedDB` remain stable across desktop launches (Electron storage is keyed by origin = scheme+host+port).
- On `EADDRINUSE`, the server-manager falls back through a short ordered list (`3766`, `3767`, `3768`). Pin the renderer to a named Electron session (`session.fromPartition("persist:weatherv1")`) so storage is partition-keyed and survives port fallback.
- Do not pick an ephemeral high port at launch — that orphans `localStorage` on every restart.

### 4. Secure Local Boundary

- Generate a per-launch desktop session token in Electron main (32+ random bytes, in memory only, never persisted).
- Inject it into all loopback requests via `session.fromPartition("persist:weatherv1").webRequest.onBeforeSendHeaders` so the renderer never touches the token directly.
- Add a Next `proxy.ts` guard. Matchers must cover `/api/:path*` **and** the rewritten static paths (`/outputs/:path*`, `/videos/:path*`) — those are aliases to API routes and must stay gated.
- Reject unauthenticated local API requests in desktop mode (`DESKTOP_MODE=1` set on child spawn).
- `proxy.ts` runs on the Node.js runtime in Next 16 (the `runtime` option is not configurable in proxy files — which is what we want).
- **Sharp edge**: per the Next 16 proxy docs, Server Actions / Server Functions are POSTed to the route in which they are declared. A matcher refactor (or a future Server Action introduction) can silently move handlers outside proxy coverage. Treat the proxy check as a perimeter, and call a shared `assertDesktopAuth(req)` helper inside any handler that mutates server state (render, upload, catalog write). Defense in depth.
- A future hardening path is `next-electron-rsc`-style in-process request interception (no loopback HTTP port at all). Out of scope for v1, noted for v2.

### 5. Runtime Config

- Replace repo-relative assumptions with an explicit runtime contract. The current code uses `process.cwd()`-derived paths in 13+ files (catalog storage, ffmpeg renderer, jobs store/worker/plan-bundle, segment-posters, and several `src/app/api/**/route.ts` handlers). All must read from a single `src/server/runtime/config.ts` module.
- Env contract:
  - `WEATHER_WORKSPACE_DIR`
  - `WEATHER_CATALOG_PATH`
  - `WEATHER_VIDEOS_DIR`
  - `WEATHER_MUSIC_DIR`
  - `WEATHER_RUNTIME_DIR`
  - `FFMPEG_PATH`
  - `FFPROBE_PATH`
- Store Electron-owned config under `app.getPath("userData")`.
- Keep rendered outputs, uploads, jobs, and caches under the Electron runtime dir.
- **Mutability model**: env is injected at child-spawn time only. There is no hot-swap. Settings changes that affect server behavior (workspace, API keys, ffmpeg paths) trigger a managed restart of the spawned child — the server-manager exposes a `restart(env)` method and the renderer shows a brief "Reloading…" overlay until health is reported green again.

### 6. Asset Source Boundary

- Introduce a server-side asset provider abstraction.
- Implement `LocalWorkspaceAssetSource` now.
- Leave the provider interface ready for a future `GoogleDriveAssetSource`.
- The provider should resolve:
  - catalog path
  - videos dir
  - music dir
  - resolved video paths
  - resolved music/background paths
  - validation of expected workspace layout

### 7. Workspace Setup

- On first launch, prompt the user to choose or initialize a local workspace folder.
- Required workspace structure for v1:
  - `notouch!/catalog.json`
  - `videos/`
  - `music/`
- If folders are missing, create them.
- If `catalog.json` is missing, initialize a minimal empty catalog file.

### 8. Credentials

- Prompt for `OPENAI_API_KEY` and optional `GEMINI_API_KEY` from the desktop UI.
- Store credentials in Electron-owned secure storage.
- Inject credentials into the Next child process only at runtime.
- Do not store secrets in `localStorage`.

### 9. FFmpeg Packaging

- Prefer bundled FFmpeg/FFprobe binaries in packaged desktop builds. Pick **one** concrete package and pin the version: `ffmpeg-static` (or `@ffmpeg-installer/ffmpeg`).
- Fall back to `PATH` during dev. Existing `FFMPEG_PATH` / `FFPROBE_PATH` envs remain as user-facing overrides.
- macOS packaging requirements:
  - Both binaries must be listed in `asarUnpack` (asar-packed executables cannot be `exec`'d).
  - Use Forge's `@electron-forge/plugin-auto-unpack-natives` so any future native modules are unpacked alongside ffmpeg.
  - Sign the host app with `@electron/osx-sign` under hardened runtime; the ffmpeg binary in `Resources/app.asar.unpacked/...` is re-signed with the host's Developer ID.
  - Entitlements must include `com.apple.security.cs.allow-jit`. Do **not** add `allow-unsigned-executable-memory` (Electron 12+).
  - Notarize with `@electron/notarize`.
- Run `verifyFFmpegAtBoot()` in **Electron main**, before spawning the Next child (see "Open Risks" below for why `instrumentation.ts` is not the right place in packaged builds).
- Pass the verification result to the renderer through the preload bridge and surface it in `SettingsModal`.

### 10. Preload Bridge

- Expose a small desktop bridge to the renderer for native-only actions:
  - `pickWorkspace`
  - `pickAudioFile`
  - `importCatalogVideo`
  - `openPath`
  - `getAppInfo`
  - `getUpdateState`
- If the implementation needs one additional settings-save method for credentials/workspace persistence, keep it scoped to config updates only.

### 11. Renderer UI Changes

- Keep existing `/api/*` fetch flows.
- Update `UploadCard` to prefer desktop-native file picking when the bridge is available.
- Update `CatalogPanel` to wire the existing "upload video" action through the desktop bridge.
- Extend `SettingsModal` to show:
  - workspace path
  - workspace validation state
  - FFmpeg status
  - OpenAI key presence
  - Gemini key presence
  - app version
  - updater state

### 12. Packaging And Updates

- Add Forge makers for:
  - macOS ZIP (`@electron-forge/maker-zip`).
  - Windows Squirrel installer (`@electron-forge/maker-squirrel`).
- Add GitHub publishing configuration for release artifacts.
- Wire packaged apps to `update-electron-app` (thin wrapper over `autoUpdater` / Squirrel.Mac / Squirrel.Windows).
- Auto-update prerequisites are non-negotiable:
  - macOS: `.app` must be signed with Developer ID and notarized; the update feed must be HTTPS and serve a Squirrel.Mac-compatible JSON.
  - Windows: installer must be signed; the feed must serve a Squirrel.Windows `RELEASES` file.
  - The free option for GitHub-hosted repos is `update.electronjs.org` (`updateSource: { type: "staticStorage", baseUrl: ... }` or the GitHub-mode auto-detection).
- Keep signing and notarization config driven by environment variables and CI secrets. Required envs in release CI:
  - macOS: `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`, certificate `.p12` + password.
  - Windows: signing cert + password.
- If staged rollouts or delta updates become a requirement, the migration target is `electron-builder` + `electron-updater`; switch deliberately rather than try to bolt onto `update-electron-app`.

## Implementation Order

1. Add shared runtime config (`src/server/runtime/config.ts`, `src/server/runtime/paths.ts`) and asset provider modules (`src/server/assets/source.ts`, `src/server/assets/local-workspace.ts`).
2. Refactor the 13+ server-side path consumers identified in the handoff to read from the runtime config instead of `process.cwd()`.
3. Add the internal health route (`src/app/api/internal/health/route.ts`) and `proxy.ts` token guard. Matchers cover `/api/*`, `/outputs/*`, `/videos/*`. Add the shared `assertDesktopAuth(req)` helper and call it inside any mutating route handler.
4. Verify FFmpeg in **Electron main** before spawning the Next child (`electron/ffmpeg-verify.cjs`). Keep an optional soft check in `instrumentation.ts` for `next dev` parity, but do not treat it as the authoritative gate (see Open Risks).
5. Add Electron main/preload/server-manager/config files, plus `scripts/prepare-standalone.cjs` for the `public/` + `.next/static/` copy step.
6. Add Forge packaging config with `@electron-forge/plugin-auto-unpack-natives`, signing/notarization config, and `asarUnpack` entries for ffmpeg/ffprobe.
7. Extend settings and desktop-aware upload/import UI (`SettingsModal`, `UploadCard`, `CatalogPanel`).
8. Add tests for runtime config, asset provider, desktop auth, and the server-manager spawn/respawn cycle.
9. Add CI for desktop build/package flows. Mac signing/notarization secrets gated to release CI only.

## Progress (updated as steps complete)

- [x] **Step 1 — runtime config + asset provider.** `src/server/runtime/config.ts`, `src/server/runtime/paths.ts`, `src/server/runtime/auth.ts`, `src/server/assets/source.ts` in place. `LocalWorkspaceAssetSource` implements the provider interface; cached singletons with reset hooks for tests.
- [x] **Step 2 — path refactor.** All known `process.cwd()`-relative path consumers now read from `getRuntimeConfig()` / `getRuntimePaths()` / `getAssetSource()`. Catalog storage exports `getCatalogPath()` / `getVideosDir()` (the old constant exports are gone). Callers updated in: `src/app/api/catalog/{health,route,tag-counts,videos,videos/[id],poster/[vidId],preview/[vidId],segment-poster/[segId]}/route.ts`, `src/app/api/{outputs/[filename],videos/[filename],transcribe}/route.ts`, `src/server/catalog/{parser,storage}.ts`, `src/server/ffmpeg/{binaries,renderer,segment-posters}.ts`, `src/server/jobs/{plan-bundle,store,worker}.ts`. `tsc --noEmit` clean; `npm test` 38/38 green.
- [x] **Step 3 — desktop perimeter.** `src/proxy.ts` gates `/api/:path*`, `/outputs/:path*`, `/videos/:path*` when `DESKTOP_MODE=1`. `src/app/api/internal/health/route.ts` returns workspace + ffmpeg readiness for the Electron supervisor. `assertDesktopAuth(req)` (returns `NextResponse | null`) wired into every mutating handler: `POST /api/transcribe`, `POST /api/plan`, `POST /api/replan_scene`, `POST /api/render`, `DELETE /api/render/[jobId]`, `POST /api/catalog/videos`, `PATCH/DELETE /api/catalog/videos/[id]`.
- [x] **Step 3 follow-through — desktop-aware route support.** `src/app/api/internal/health/route.ts` is now auth-gated in desktop mode. `src/app/api/desktop/status/route.ts` exists for future settings/runtime status. `POST /api/transcribe` now accepts browser multipart upload and desktop JSON payloads with `desktop_file_path`. `POST /api/catalog/videos` now accepts browser multipart upload and desktop JSON payloads with `desktop_file_path` plus metadata. Shared bridge typing groundwork is present in `src/shared/desktop.ts` and `src/types/desktop.d.ts`.
- [x] **Step 4 — Electron-main FFmpeg verify.** `electron/ffmpeg-verify.cjs` is the authoritative gate Electron main calls before spawning the Next child. Resolution order: explicit env (`FFMPEG_PATH` / `FFPROBE_PATH`) → bundled (`ffmpeg-static` / `ffprobe-static` / `@ffmpeg-installer/ffmpeg` / `@ffprobe-installer/ffprobe`, with `app.asar` → `app.asar.unpacked` rewrite) → system `PATH`. Returns a structured `{ ok, ffmpegPath, ffprobePath, ffmpegSource, ffprobeSource, errors, warnings }`; never throws, so the renderer can surface failures in settings. `instrumentation.ts` keeps a soft (warning-only, dev-only) parity check that is explicitly non-authoritative — Electron main owns the real verdict. New `src/test/ffmpeg-verify.test.ts` (5 tests) locks in the public shape, asar-path rewrite (POSIX + Windows), and missing-env-path warning behavior. Module smoke-runs cleanly with system ffmpeg.
- [x] **Step 5 — Electron shell.** `next.config.ts` now sets `output: "standalone"`. New files: `electron/config.cjs` (userData-backed settings, `safeStorage` for API keys with documented plaintext fallback, per-launch 32-byte session token, env-block builder), `electron/server-manager.cjs` (deterministic port pick {3765, 3766, 3767, 3768}, dev → `node_modules/.bin/next dev`, prod → `node .next/standalone/server.js` with cwd at the standalone dir, `restart(env)` for settings-driven managed restarts, health polling against `/api/internal/health` with the desktop token), `electron/preload.cjs` (contextBridge `window.desktop` matching the `DesktopBridge` interface in `src/shared/desktop.ts`), `electron/main.cjs` (lifecycle: ffmpeg verify → token gen → env build → spawn → health wait → BrowserWindow pinned to `session.fromPartition("persist:weatherv1")` → token injected via `webRequest.onBeforeSendHeaders` so the renderer never holds it → `desktop:*` IPC handlers), `scripts/prepare-standalone.cjs` (copies `public/` and `.next/static/` into `.next/standalone/`). `package.json` gains `"main": "electron/main.cjs"` plus `standalone:prep`, `electron:dev`, `electron:build`, `electron:make` scripts. `BrowserWindow` is sandboxed: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`; `setWindowOpenHandler` routes external links to the OS browser. **Not yet runnable** — `electron`, `electron-forge`, and the bundled ffmpeg packages are not installed; Step 6 owns that. `tsc --noEmit` clean; `npm test` 43/43 green; both CJS modules load standalone; `pickPort()` returns 3765 from a clean port; `scripts/prepare-standalone.cjs` correctly errors with a clear message when run before `next build`.
- [ ] Step 6 — Forge packaging (this is where `ffmpeg-static` / `ffprobe-static` (or the `@ffmpeg-installer` equivalents) get installed and pinned, and where the `asarUnpack` entries lock in the path rewrite Step 4 already handles at call time)
- [ ] Step 7 — Desktop-aware UI (Settings/Upload/Catalog)
- [ ] Step 8 — Tests for runtime/auth/server-manager
- [ ] Step 9 — Desktop CI

## Acceptance Criteria

- Electron launches the app through a managed local Next server.
- The app works with a user-selected local workspace instead of repo-relative paths.
- Desktop API requests are token-gated in desktop mode.
- The app shows workspace, key, FFmpeg, version, and updater info in settings.
- Audio upload and catalog video import work through native desktop file pickers.
- Packaged builds have a defined path for updates and signing.

## Open Risks & Sharp Edges (Research Update 2026-05)

### `instrumentation.ts` does not run under `node .next/standalone/server.js`
- Tracked upstream as [vercel/next.js#89377](https://github.com/vercel/next.js/issues/89377), open as of 2026-05. The standalone tracer omits `instrumentation.ts`; `register()` is silently skipped in the packaged build.
- Impact: any "verify FFmpeg at boot" gate placed in `instrumentation.ts` will fail open. The first ffmpeg-touching request becomes the failure surface, which is exactly what a boot check was supposed to prevent.
- Mitigation: ffmpeg verification runs in Electron main, before the child is spawned. Renderer reads the result through the preload bridge. `instrumentation.ts` may still hold a parallel check for `next dev`, but is not authoritative in packaged builds.

### `proxy.ts` is not a substitute for in-handler auth
- Per Next 16 proxy docs, Server Actions / Server Functions are POSTed to the route in which they are declared. A matcher refactor — or someone introducing a Server Action — can silently move handlers outside proxy coverage.
- Mitigation: keep the token check in `proxy.ts` for fast rejection, **and** call `assertDesktopAuth(req)` inside any handler that mutates server state (render, upload, catalog write, settings update). Defense in depth.
- The `runtime` config option is not available inside `proxy.ts` in Next 16 — proxy always runs on the Node.js runtime, which is what this plan wants.

### asar + native binaries
- ffmpeg, ffprobe, and any future `node-gyp`-built native module must be listed in `asarUnpack`. Executables packed into `app.asar` cannot be `exec`'d.
- On macOS, the unpacked binary must be co-signed under the host's Developer ID with hardened runtime, and entitlements must include `com.apple.security.cs.allow-jit`. Skipping this surfaces as Gatekeeper SIGKILL at first launch.
- Forge's `@electron-forge/plugin-auto-unpack-natives` handles natives; ffmpeg/ffprobe need explicit `asarUnpack` entries because they aren't `*.node` files.

### Fixed loopback port collision
- `3765` will EADDRINUSE if the user has a dev server bound there. The server-manager must try `3765`, then walk an ordered fallback list (`3766`, `3767`, `3768`).
- Pin the renderer to a named Electron session (`session.fromPartition("persist:weatherv1")`) so `localStorage` is keyed by partition, not origin. This decouples storage from the port and means a fallback launch does not orphan stored state.

### Auto-update is gated on signing
- `update-electron-app` requires a signed app and an HTTPS Squirrel-compatible feed on **both** macOS and Windows. There is no "skip signing, ship updates" path with this stack.
- Before any release CI work, confirm that Developer ID certs (macOS) and a code-signing cert (Windows) are available and that the team has an Apple App-Specific Password ready.

### Standalone + sibling assets
- The repo currently reads from a sibling `../v1Drive` tree in dev. Next standalone tracing does not include arbitrary sibling directories.
- Resolution: the asset-provider boundary moves user media to `WEATHER_WORKSPACE_DIR`, which is chosen at first launch and lives outside the bundle. Standalone tracing is not in play for user-supplied media in v1.
- Once the workspace is wired, run the "desktop dev boot through Electron" verification step from the handoff before doing any packaging work — that's the moment a wrong path assumption surfaces.

### Settings restart UX
- API-key, workspace-path, and ffmpeg-path changes all require a child restart.
- The server-manager exposes `restart(env)`. Renderer shows a "Reloading…" overlay until the `/api/internal/health` route reports green and ffmpeg re-verifies in main.

## Out Of Scope For V1

- Google Drive asset browsing or syncing.
- Rewriting the app into a pure IPC-native renderer.
- Replacing existing `/api/*` contracts.
- `next-electron-rsc`-style in-process request interception (no loopback port). Worth a v2 evaluation; not v1.
- `electron-builder` migration. Only revisit if delta updates or staged rollouts become required.

## References

- Next.js standalone output — https://nextjs.org/docs/app/api-reference/config/next-config-js/output
- Next.js 16 `proxy.ts` (formerly `middleware.ts`) — https://nextjs.org/docs/app/api-reference/file-conventions/proxy
- Next.js `instrumentation.ts` standalone bug — https://github.com/vercel/next.js/issues/89377
- Electron Forge — https://www.electronforge.io/
- `@electron-forge/plugin-auto-unpack-natives` — https://www.electronforge.io/config/plugins/auto-unpack-natives
- Electron asar archives — https://www.electronjs.org/docs/latest/tutorial/asar-archives
- Electron updates / `update-electron-app` — https://www.electronjs.org/docs/latest/tutorial/updates
- Electron security checklist — https://www.electronjs.org/docs/latest/tutorial/security
- `next-electron-rsc` (in-process alternative to loopback) — https://www.npmjs.com/package/next-electron-rsc
- `ffmpeg-static` — https://www.npmjs.com/package/ffmpeg-static
