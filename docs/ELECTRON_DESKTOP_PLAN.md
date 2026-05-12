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

- Add Electron as the desktop shell.
- Use `Electron Forge` for local dev, packaging, and publishing scaffolding.
- Raise the desktop toolchain baseline to `Node 22 LTS`.

### 2. Local Next Server

- Keep Next as the app UI and API backend.
- Enable `output: "standalone"` in `next.config.ts`.
- After `next build`, copy `public/` and `.next/static/` into `.next/standalone/`.
- In packaged Electron builds, launch the generated standalone `server.js` as a managed local child process.
- In dev Electron builds, launch `next dev` as the managed child process.

### 3. Fixed Local Origin

- Use one fixed loopback origin such as `http://127.0.0.1:3765`.
- Keep the origin stable so browser `localStorage` remains stable across desktop launches.

### 4. Secure Local Boundary

- Generate a per-launch desktop session token in Electron main.
- Inject it into loopback requests from the Electron session.
- Add a Next `proxy.ts` guard for `/api/:path*`.
- Reject unauthenticated local API requests in desktop mode.

### 5. Runtime Config

- Replace repo-relative assumptions with an explicit runtime contract:
  - `WEATHER_WORKSPACE_DIR`
  - `WEATHER_CATALOG_PATH`
  - `WEATHER_VIDEOS_DIR`
  - `WEATHER_MUSIC_DIR`
  - `WEATHER_RUNTIME_DIR`
  - `FFMPEG_PATH`
  - `FFPROBE_PATH`
- Store Electron-owned config under `app.getPath("userData")`.
- Keep rendered outputs, uploads, jobs, and caches under the Electron runtime dir.

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

- Prefer bundled FFmpeg/FFprobe binaries in packaged desktop builds.
- Fall back to `PATH` during dev.
- Call `verifyFFmpegAtBoot()` during server startup.
- Surface FFmpeg status in settings.

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
  - macOS ZIP
  - Windows Squirrel installer
- Add GitHub publishing configuration for release artifacts.
- Wire packaged apps to `update-electron-app` / `autoUpdater`.
- Keep signing and notarization config driven by environment variables and CI secrets.

## Implementation Order

1. Add shared runtime config and asset provider modules.
2. Refactor server-side path consumers to use the runtime config instead of `process.cwd()` assumptions.
3. Add the internal health route and desktop session-token proxy guard.
4. Update `instrumentation.ts` to verify FFmpeg at boot.
5. Add Electron main/preload/server-manager/config files.
6. Add standalone build support and Forge packaging config.
7. Extend settings and desktop-aware upload/import UI.
8. Add tests for runtime config, provider behavior, and desktop auth.
9. Add CI for desktop build/package flows.

## Acceptance Criteria

- Electron launches the app through a managed local Next server.
- The app works with a user-selected local workspace instead of repo-relative paths.
- Desktop API requests are token-gated in desktop mode.
- The app shows workspace, key, FFmpeg, version, and updater info in settings.
- Audio upload and catalog video import work through native desktop file pickers.
- Packaged builds have a defined path for updates and signing.

## Out Of Scope For V1

- Google Drive asset browsing or syncing.
- Rewriting the app into a pure IPC-native renderer.
- Replacing existing `/api/*` contracts.
