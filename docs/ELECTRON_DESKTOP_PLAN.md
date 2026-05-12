# Electron Desktop Plan For `weatherv1-next`

## Summary

- Build a real local desktop app, not a static export.
- Keep the current Next.js App Router UI and `/api/*` flows.
- Run the app inside Electron with a bundled local Next server.
- Target `macOS + Windows` first.
- Keep assets local in v1, but isolate asset access behind a provider boundary so Google Drive can replace the local source later.
- Ship installers from GitHub Actions on `v*` tags, attach stable-named assets to GitHub Releases, and publish a simple download page from GitHub Pages.

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

## Progress

**Last verified:** `tsc --noEmit` clean; `npm test` 49/49; `npm run build` produces `.next/standalone/server.js`; `npm run standalone:prep` copies `public/` + `.next/static/`; `electron/ffmpeg-verify.cjs` smoke-runs OK against system ffmpeg; `forge.config.cjs` loads cleanly; `npm run electron:dev` boots Electron + managed Next dev on `127.0.0.1:3765` and `/api/internal/health` returns 200. `next build` still emits the known Turbopack NFT warning through `src/server/ffmpeg/binaries.ts` / `/api/internal/health`, but completes successfully.

| Step | Status | What landed | Sharp edges captured |
| --- | --- | --- | --- |
| 1. Runtime config + asset provider | ✅ | `src/server/runtime/{config,paths,auth}.ts`, `src/server/assets/source.ts` (`LocalWorkspaceAssetSource`). | Cached singletons; reset hooks for tests. |
| 2. Path refactor | ✅ | All known `process.cwd()`-relative consumers now read `getRuntimeConfig()` / `getRuntimePaths()` / `getAssetSource()`. `getCatalogPath()`/`getVideosDir()` replace the old `CATALOG_PATH`/`VIDEOS_DIR` constants. Callers: `src/app/api/catalog/{health,route,tag-counts,videos,videos/[id],poster/[vidId],preview/[vidId],segment-poster/[segId]}/route.ts`, `src/app/api/{outputs/[filename],videos/[filename],transcribe}/route.ts`, `src/server/catalog/{parser,storage}.ts`, `src/server/ffmpeg/{binaries,renderer,segment-posters}.ts`, `src/server/jobs/{plan-bundle,store,worker}.ts`. | Old constant exports are gone — any new callers must use the getters. |
| 3. Desktop perimeter | ✅ | `src/proxy.ts` matches `/api/:path*`, `/outputs/:path*`, `/videos/:path*`. `src/app/api/internal/health/route.ts` is the supervisor's boot probe (auth-gated). `assertDesktopAuth(req)` returns `NextResponse \| null` and is called inside every mutating handler: `POST /api/transcribe`, `POST /api/plan`, `POST /api/replan_scene`, `POST /api/render`, `DELETE /api/render/[jobId]`, `POST /api/catalog/videos`, `PATCH/DELETE /api/catalog/videos/[id]`. | `proxy.ts` is the perimeter; in-handler asserts are defense in depth (Server Actions can bypass the proxy if introduced later). |
| 3.5. Desktop-aware route support | ✅ | `/api/desktop/status` GET. `POST /api/transcribe` and `POST /api/catalog/videos` both accept browser multipart **and** desktop JSON `desktop_file_path`. Shared bridge types in `src/shared/desktop.ts` and ambient declaration in `src/types/desktop.d.ts`. | Routes branch on `Content-Type`; tests in Step 8 should cover both paths. |
| 4. Electron-main ffmpeg verify | ✅ | `electron/ffmpeg-verify.cjs` resolves env → bundled (`ffmpeg-static`/`ffprobe-static`/`@ffmpeg-installer/*`/`@ffprobe-installer/*` with `app.asar` → `app.asar.unpacked` rewrite) → system `PATH`. Returns `{ ok, ffmpegPath, ffprobePath, ffmpegSource, ffprobeSource, errors, warnings }` — never throws. `instrumentation.ts` keeps a soft warning-only check for `next dev` parity (non-authoritative). `src/test/ffmpeg-verify.test.ts` (5 tests). | The standalone bug (`vercel/next.js#89377`) is why we can't trust `instrumentation.ts` as the authoritative gate. |
| 5. Electron shell | ✅ | `electron/{config,server-manager,preload,main}.cjs`. `scripts/prepare-standalone.cjs`. `scripts/run-electron.cjs` clears inherited `ELECTRON_RUN_AS_NODE` before launching Electron in dev. `next.config.ts` sets `output: "standalone"` and pins `turbopack.root: __dirname`. `vitest.config.ts` excludes `**/.next/**`. `package.json` gains `"main": "electron/main.cjs"` + `standalone:prep` / `electron:dev` / `electron:build` / `electron:make`. | (a) `turbopack.root` pin is mandatory — without it, `server.js` lands at `.next/standalone/<host-subpath>/server.js`, silently breaking `server-manager.cjs`. (b) `.next/**` vitest exclude is mandatory — standalone copies `src/test/**` so tests would otherwise run twice. (c) BrowserWindow is sandboxed: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`. (d) Codex/dev shells may export `ELECTRON_RUN_AS_NODE=1`; launch through `npm run electron:dev`, not raw `electron .`. |
| 6. Forge packaging | ✅ (config only — `npm install` deferred) | `forge.config.cjs` (asar + asarUnpack for ffmpeg packages and `.next/standalone/**`, osxSign with `signatureFlags: "library"`, osxNotarize from env, macOS ZIP + Windows Squirrel makers, `@electron-forge/plugin-auto-unpack-natives`, commented GitHub publisher). `build/entitlements.mac.plist` with `allow-jit`, `disable-library-validation`, `allow-dyld-environment-variables`; **not** `allow-unsigned-executable-memory`. `update-electron-app` + `autoUpdater` events wired in `main.cjs`. `electron-squirrel-startup` short-circuit at the top of `main.cjs`. Deps pinned: `electron@^33`, four `@electron-forge/*@^7` packages, `ffmpeg-static@^5`, `ffprobe-static@^3`, `update-electron-app@^3`, `electron-squirrel-startup@^1`. | Requires in `main.cjs` for the two new optional deps are wrapped in try/catch so the dev path doesn't break before `npm install`. |
| 7. Desktop-aware UI | ✅ | `src/client/lib/desktop.ts` provides SSR-safe bridge access. `SettingsModal` now shows desktop workspace validation, ffmpeg status, OpenAI/Gemini key presence, app version, update state, editable workspace/ffmpeg paths, API key entry, and a save/restart overlay. `UploadCard` uses `window.desktop.pickAudioFile()` when available and posts `{ desktop_file_path }` JSON to `/api/transcribe`; browser upload still uses multipart. `CatalogPanel` uses `window.desktop.importCatalogVideo()` when available and falls back to a browser file input; both paths post to `/api/catalog/videos` and invalidate catalog/tag queries. | Settings save only sends non-empty key fields, so blank password boxes do not clear stored keys. The real native picker round-trip still needs an Electron launch smoke test. |
| 8. Tests | ✅ | Added `src/test/runtime-desktop.test.ts` for runtime env resolution, asset workspace scaffolding, and desktop auth. Added `src/test/server-manager.test.ts` for standalone/dev entrypoint resolution. Full suite is now 49/49. | Socket-bound server-manager tests hit `EPERM` in the local sandbox, so this pass kept server-manager coverage to pure unit checks. Full spawn/restart behavior should be covered in CI or a less restricted harness. |
| 9. Desktop CI + release delivery | ✅ | Added `.github/workflows/desktop.yml` with a macOS + Windows Node 22 matrix: `npm ci`, `tsc`, `npm test`, unsigned `electron:build` on PRs, `electron:make` on `v*` tags, and artifact upload from `out/**`. Added `.github/workflows/desktop-publish-release.yml` to attach stable-named release assets (`WeatherV1-macOS.zip`, `WeatherV1-Setup.exe`) after a successful Desktop tag run. Added `.github/workflows/pages.yml` plus `docs/download-page/index.html.template` so GitHub Pages can publish a simple install/download page. `forge.config.cjs` now gates macOS signing on an imported CI certificate, uses `notarytool`, and expects decoded Windows cert files via `WIN_CERT_FILE`. | GitHub Releases publishing is handled by workflow orchestration rather than the commented Forge publisher block. Signed public releases still depend on the secrets and repository Pages settings being configured in GitHub. |

## Quick start for the next agent

**Working directory** is `/Users/barmoshe/claude-creative-stack/weatherv1-next` (it's a child repo with its own `.git` — never `git add` from the host root).

**Before you run anything, install deps once:**

```
npm install   # materializes electron / forge / ffmpeg-static / etc. (Step 6 pinned them)
```

The repo's tests + `tsc` + `next build` all pass *without* this install — the new Electron requires in `main.cjs` are wrapped in try/catch. Install only when you need to actually launch Electron.

**Daily commands:**

| Goal | Command |
| --- | --- |
| Typecheck | `npx tsc --noEmit` |
| Run tests | `npm test` |
| Run the web app (no Electron) | `npm run dev` |
| Build the standalone Next tree | `node_modules/.bin/next build && node scripts/prepare-standalone.cjs` |
| Launch the Electron dev shell (after `npm install`) | `npm run electron:dev` |
| Package an unsigned local build | `npm run electron:build` |
| Make installer artifacts (ZIP / Squirrel) | `npm run electron:make` |

**Tag-based release flow:**

| Goal | Command / action |
| --- | --- |
| Create release installers in CI | `git tag v0.1.x && git push origin v0.1.x` |
| Attach stable installer names to the GitHub Release | automatic via `.github/workflows/desktop-publish-release.yml` after Desktop succeeds |
| Publish/update the public download page | automatic via `.github/workflows/pages.yml` when `docs/download-page/**` changes and GitHub Pages is set to `GitHub Actions` |

**Key file map:**

```
electron/
  main.cjs               Lifecycle, BrowserWindow, session token injection, desktop:* IPC
  preload.cjs            contextBridge `window.desktop` (matches src/shared/desktop.ts)
  server-manager.cjs     Port pick, spawn dev/prod child, health poll, restart(env)
  config.cjs             userData settings, safeStorage keys, env builder, token gen
  ffmpeg-verify.cjs      env → bundled → PATH resolution; asar→asar.unpacked rewrite
forge.config.cjs         Packager + makers + plugins + sign/notarize (env-driven)
build/entitlements.mac.plist
scripts/prepare-standalone.cjs   Copies public/ + .next/static/ into .next/standalone/
src/proxy.ts             Desktop token guard; matchers /api|/outputs|/videos
src/app/api/internal/health/route.ts   Supervisor boot probe (auth-gated)
src/app/api/desktop/status/route.ts    Runtime/workspace/key status
src/server/runtime/{config,paths,auth}.ts
src/server/assets/source.ts            LocalWorkspaceAssetSource
src/shared/desktop.ts                  DesktopBridge interface used by preload + renderer
src/types/desktop.d.ts                 Window.desktop global ambient declaration
```

**Sharp edges worth re-reading before touching anything:**

- `turbopack.root: __dirname` in `next.config.ts` — host repo has its own lockfile one level up; without the pin, the standalone tree gets misplaced.
- `vitest.config.ts` excludes `**/.next/**` — `output: "standalone"` copies the test files; without the exclude, tests run twice.
- `assertDesktopAuth` must be called in every new mutating handler, not just trusted to the proxy. Server Actions in particular get POSTed to the route file that declares them and can bypass the proxy matcher.
- ffmpeg/ffprobe binaries cannot live inside `app.asar`. `forge.config.cjs` lists them in `asarUnpack`; `electron/ffmpeg-verify.cjs` rewrites the path at call time.
- macOS hardened runtime entitlements deliberately omit `allow-unsigned-executable-memory` (Electron 12+ doesn't need it). Don't add it back without a reason.
- `update-electron-app` requires a signed app on both macOS and Windows. There is no "skip signing, ship updates" path on this stack.

## Remaining Smoke Tests

The implementation is complete; what remains is operational verification of the shipped flow:

1. Pick/save a workspace path in Settings and confirm the restart overlay resolves cleanly.
2. Enter an OpenAI key, save, and confirm `/api/desktop/status` reports `openai_configured: true`.
3. Run audio transcription through the native picker and confirm the `{ desktop_file_path }` route path works end to end.
4. Import a catalog video through the native picker and confirm catalog/tag queries refresh.
5. Run a full render pipeline using a user-chosen workspace and confirm outputs/videos are served correctly through the desktop perimeter.
6. Validate a tagged GitHub release end to end: Desktop workflow succeeds, release assets are attached with stable names, and the GitHub Pages download page points users at the current installers.
7. After signing secrets are configured, validate signed/notarized installs on both macOS and Windows.

## Desktop CI Details

`.github/workflows/desktop.yml` now runs a `macos-latest` + `windows-latest` matrix. Build steps:

1. `actions/checkout@v5` and `actions/setup-node@v5` (the existing `ci.yml` is still on `@v4` — GitHub will force those to Node.js 24 by June 2026, so bump them when you touch them) with `node-version: '22'` (matches the desktop plan's Node 22 LTS baseline for `next build`).
2. `npm ci` with `ELECTRON_SKIP_BINARY_DOWNLOAD=1` set as a job env var for the existing typecheck/test jobs that don't need the Electron binary. The desktop-build job (`electron:make`) needs the binary, so leave the env var unset there.
3. `npm test && npx tsc --noEmit`.
4. PRs run `npm run electron:build` for unsigned packaging smoke coverage.
5. `v*` tags run `npm run electron:make` (which runs `next build && standalone:prep && electron-forge make`).
5. Upload artifacts: `out/make/**`.

Signing/notarization secrets live in repo Actions secrets and are only set on the release CI path (tag push). Required:

- macOS: `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`, a Developer ID cert imported into the keychain (`apple-actions/import-codesign-certs`).
- Windows: `WIN_CERT_FILE` (a base64-encoded `.p12`), `WIN_CERT_PASSWORD`.

PR CI runs the unsigned `electron-forge package` only — no notarization, no publishing. Release CI on a `v*` tag adds the publisher step (`electron-forge publish` with the GitHub publisher uncommented in `forge.config.cjs`).

### Lockfile gotcha (resolved on `171a502`)

Adding the Electron / Forge / ffmpeg deps in Step 6 broke `npm ci` in the existing `.github/workflows/ci.yml` for two commits because `package-lock.json` wasn't regenerated alongside `package.json`. `npm ci` requires the lockfile and `package.json` to match exactly. The fix is to run `npm install --package-lock-only --ignore-scripts` after any `package.json` dep change and commit the resulting lockfile diff. The two failing runs were `25735788933` and `25736054166`; `25736312902` (commit `171a502 Update package-lock.json`) is the first green one. **Rule of thumb: never push a `package.json` change without the matching `package-lock.json` change in the same commit.**

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
