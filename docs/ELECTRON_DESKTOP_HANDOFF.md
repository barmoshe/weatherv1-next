# Electron Desktop Handoff Report

## Status

- No Electron implementation has been started in this pass.
- This report captures the current repo findings, the chosen architecture, and the work order for the next implementation pass.

## Current Repo Snapshot

- Project root: `/Users/barmoshe/claude-creative-stack/weatherv1-next`
- Current local runtime discovered during research:
  - `node`: `v20.19.3`
  - `npm`: `11.7.0`
  - `npx node@22`: available and resolves to `v22.22.2`
- Current app stack:
  - `next`: `16.2.6`
  - `react`: `19.2.4`
  - `vitest`: `2.x`

## Key Technical Findings

### Next.js-Specific

- The repo includes an explicit warning in `AGENTS.md` to consult local Next docs before changing conventions.
- The bundled docs confirm:
  - `output: "standalone"` is the right fit for packaging a minimal Node server.
  - `custom server` should not be combined with standalone output.
  - In Next 16, `middleware` has been renamed to `proxy`.

Relevant docs inspected in-repo:

- `node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/output.md`
- `node_modules/next/dist/docs/01-app/02-guides/custom-server.md`
- `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md`

### Server / Runtime

- The app is not a static frontend.
- It depends on:
  - route handlers under `src/app/api/**`
  - on-disk runtime state
  - FFmpeg child processes
  - an in-process queue worker started from `instrumentation.ts`

Files that make this clear:

- `instrumentation.ts`
- `src/server/jobs/worker.ts`
- `src/server/jobs/store.ts`
- `src/server/jobs/plan-bundle.ts`
- `src/server/ffmpeg/binaries.ts`
- `src/server/ffmpeg/renderer.ts`
- `src/server/ffmpeg/probe.ts`

### Path Assumptions That Must Be Refactored

- Current catalog and media paths still depend on repo-relative filesystem layout:
  - `src/server/catalog/storage.ts`
  - `src/server/ffmpeg/renderer.ts`
- Runtime files still assume `process.cwd()/runtime/...`:
  - `src/server/jobs/store.ts`
  - `src/server/jobs/plan-bundle.ts`
  - `src/server/jobs/worker.ts`
  - `src/app/api/transcribe/route.ts`
  - `src/app/api/outputs/[filename]/route.ts`
  - `src/app/api/catalog/poster/[vidId]/route.ts`
  - `src/app/api/catalog/preview/[vidId]/route.ts`
  - `src/server/ffmpeg/segment-posters.ts`

### UI Entry Points Affected

- Settings modal is currently catalog-health only:
  - `src/client/components/studio/SettingsModal.tsx`
- Audio upload is HTML input / drag-drop based:
  - `src/client/components/studio/UploadCard.tsx`
- Catalog upload button exists in UI but is not wired to a desktop-native action:
  - `src/client/components/catalog/CatalogPanel.tsx`

## Approved Direction

- Electron wraps the current Next app.
- Next remains the UI and API layer.
- A bundled standalone Next server runs locally behind Electron.
- A workspace folder replaces repo-relative media assumptions.
- Desktop-only actions move through preload.
- Assets remain local in v1.
- Google Drive is deferred, but the asset-provider boundary should be created now.

## Recommended File/Module Additions

### New Runtime Modules

- `src/server/runtime/config.ts`
  - centralizes workspace/runtime/binary/env resolution
- `src/server/runtime/paths.ts`
  - centralizes uploads/outputs/cache directory paths
- `src/server/assets/source.ts`
  - provider interface
- `src/server/assets/local-workspace.ts`
  - local workspace implementation

### New Next Entry Points

- `src/app/api/internal/health/route.ts`
  - desktop boot check route
- `proxy.ts`
  - desktop token guard for `/api/*`

### New Electron Files

- `electron/main.cjs`
- `electron/preload.cjs`
- `electron/server-manager.cjs`
- `electron/config.cjs`
- `forge.config.cjs`
- `scripts/prepare-standalone.cjs`

### New Renderer Types / Helpers

- `src/shared/desktop.ts`
- `src/types/desktop.d.ts` or equivalent ambient declaration
- optional helper for converting desktop-picked buffers into `File` objects

## Risks To Watch

### 1. Running The Bundled Next Server In Packaged Electron

- This is the trickiest implementation detail.
- The plan assumes Electron main launches the standalone `server.js` as a managed local process in packaged builds.
- Verify early that the packaged runtime can execute the server entrypoint with access to traced files and modules.

### 2. Secure Credential Storage

- The current web app reads API keys from process env.
- Desktop settings must persist them outside `localStorage`.
- The implementation should keep secrets entirely on the Electron side and only inject them into the child server process at launch.

### 3. FFmpeg Packaging

- Desktop builds should prefer bundled FFmpeg/FFprobe binaries.
- Dev should continue to allow `PATH` fallback.
- Validate the packaged binary paths before wiring updater/release work.

### 4. Settings Mutability

- Some settings changes, especially workspace and credentials, likely require a child server restart.
- Plan for restart/reload behavior instead of trying to hot-swap server env in place.

## Suggested Implementation Sequence

1. Refactor path resolution and runtime config first.
2. Introduce the asset provider boundary.
3. Add the proxy auth and internal health route.
4. Wire FFmpeg verification into startup.
5. Add Electron process management and preload bridge.
6. Make upload/import/settings desktop-aware.
7. Add Forge packaging and GitHub update config.
8. Add tests and CI last.

## Verification Checklist For The Next Pass

- `npm test`
- `tsc --noEmit`
- `next build` with standalone output
- desktop dev boot through Electron
- desktop settings workflow
- audio upload through native picker
- catalog video import through native picker
- render pipeline with local workspace
- packaged build smoke test

## Stop Point

- This pass ends with documentation only.
- No source implementation, dependency install, or packaging changes were applied.
