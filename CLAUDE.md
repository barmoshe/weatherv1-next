# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Heads up: Next.js 16

This repo runs **Next.js 16** with React 19. APIs, conventions, and file structure may differ from your training data. Before writing route handlers, middleware, instrumentation, config, or anything touching Next behavior, read the matching file under `node_modules/next/dist/docs/`. Heed deprecation notices.

## Start here for substantial work

1. `docs/PROJECT_GOAL.md` — current product/engineering goal, "Done means" checklist, invariants.
2. `docs/DOCS_INDEX.md` — task-to-doc router and code map.
3. `AGENTS.md` — short operational map (safety rules, commit style, verification defaults).
4. For Electron work: `docs/ELECTRON.md` (single reference — architecture, IPC, pitfalls, sharp edges, packaging, release path).
5. For R2 / Worker / Pulumi: `docs/R2_PULUMI_HANDOFF.md` + `docs/CLOUDFLARE_INTEGRATION.md` + `infra/cloudflare/README.md`.
6. For releases: `docs/RELEASE_CONVENTION.md` (or invoke the `weatherv1-release` skill).
7. For new goal-driven sessions, invoke the `weatherv1-goal` skill (`/weatherv1-goal`).

## Queued and historical work

**Active docs** live at the root of `docs/` and are the current source of truth. Completed or superseded work lives in `docs/archive/` — useful as historical reference or to understand prior approaches, but not authoritative for current work. Planned but un-shipped features live in `docs/future/` — these are valid roadmap items, not the active spec. See `docs/archive/README.md` and `docs/future/README.md` for inventories.

## Commands

```bash
# Setup
nvm use 20                       # Node 20+ required
npm install                      # do not switch to pnpm/yarn (lockfile mismatch)
cp .env.example .env             # fill in OPENAI_API_KEY (required)

# Dev
npm run dev                      # web: http://localhost:3000
npm run electron:dev             # Electron + managed Next child on http://127.0.0.1:3765

# Verify
npx tsc --noEmit                 # type check (project uses "noEmit": true, no separate tsc build)
npm test                         # vitest run (jsdom env, src/test/**)
npm test -- src/test/picker.test.ts          # single test file
npm test -- -t "matches a substring"         # single test by name
npm run test:watch                            # vitest watch

# Build / package
npm run build                    # Next production build (output: "standalone")
npm run standalone:prep          # copy public/ + .next/static into .next/standalone (required for Electron)
npm run electron:build           # next build && standalone:prep && electron-forge package
npm run electron:make            # …+ electron-forge make → installers in out/

# Repo packaging for NotebookLM briefings
npm run notebooklm:export:chunks
```

**Verification defaults** (from AGENTS.md):
- Server/runtime changes → `npx tsc --noEmit` + `npm test`.
- Next route or build behavior → also `npm run build`.
- Electron startup/package changes → also `npm run standalone:prep` and, when feasible, `npm run electron:build`.

## Architecture

WeatherV1 is a **local-first pipeline** that turns recorded narration into a **9:16 forecast MP4**:
audio MP3 → OpenAI Whisper transcript → scene planner → pick clips from a local catalog (`v1Drive`/workspace) → ffmpeg render. The same Next.js app runs in two runtimes — web/server and Electron desktop — sharing all of `src/`.

### Two runtimes, same app

- **Web/server mode**: long-lived Node host or Docker VM with native ffmpeg on `PATH`; uses `../v1Drive/weather` as the media root by default.
- **Desktop mode**: Electron shell supervises a Next standalone child server; ffmpeg comes from `ffmpeg-static` + `ffprobe-static`; the user picks a workspace directory; per-launch session-token auth gates `/api/*`.

Switching is driven by runtime detection in `src/server/runtime/` — most code in `src/server/**` and `src/app/**` should not care which runtime it is in.

### Electron process model (read `docs/ELECTRON.md` before editing `electron/`)

Four processes:

- **main** (`electron/main.cjs`) — Node, owns `BrowserWindow`, IPC handlers, session token, auth interceptor that injects `x-weather-desktop-token` on loopback requests.
- **preload** (`electron/preload.cjs`) — isolated; exposes a narrow `window.desktop.*` API via `contextBridge`. One wrapper function per channel — never expose `ipcRenderer` itself.
- **renderer** — the Next.js UI at `http://127.0.0.1:<port>`. No Node, no `fs`. Cannot import from `src/server/*`.
- **Next child server** — spawned by `electron/server-manager.cjs` via the `fork()` wrapper (uses Electron Helper as Node so macOS does not get a duplicate dock tile). Runs `.next/standalone/server.js`.

Loopback host is **`127.0.0.1`** (not `localhost`) and ports are deterministic: `3765` then fallbacks `3766/3767/3768` (`electron/config.cjs`). API keys are persisted via main-process `safeStorage`, never in renderer `localStorage`.

### Desktop perimeter (auth)

`src/proxy.ts` (Next middleware on `/api/*`, `/outputs/*`, `/videos/*`) calls `isDesktopRequestAuthorized` to enforce the per-launch token in desktop mode. **It is the perimeter, not the only guard** — mutating handlers must also re-check via `src/server/runtime/auth.ts`. Web mode short-circuits the check.

### Server layout (`src/server/`)

- `runtime/` — runtime config, derived paths, desktop auth, R2 env. Single source of truth for "where do files live" and "is this a desktop request."
- `catalog/` — parse/persist the `v1Drive` catalog (videos, segments, posters, tags).
- `pipeline/` — scene planner, picker, validator, beat tagging. Timeline picks carry both `picker_reason` (LLM editorial) and `reason` (post-validator).
- `ffmpeg/` — binary resolution, probe, preview/poster generation, the render graph.
- `jobs/` — file-backed job store, queue, worker drain, plan-bundle hydration, usage persist.
- `providers/` — pluggable LLM (Anthropic/OpenAI) + OpenAI Whisper cloud transcription with unified error mapping.
- `sync/r2/` — **optional** Cloudflare R2 sidecar (catalog/media/posters/voiceovers). The local catalog is always the hot path; R2 mints short-lived S3 creds via the Worker gateway, and remote-only rows **materialize to disk before ffmpeg runs**.
- `assets/`, `billing/`, `tag-vocab.ts` — supporting modules.

### Routes and rendering (`src/app/`)

App Router. `src/app/api/*` is the HTTP surface: `plan`, `replan_scene`, `render`, `status`, `transcribe`, `catalog`, `jobs`, `outputs`, `videos`, `config`, `desktop`, `internal`, `runtime`, `sync`. `outputs/` and `videos/` are rewritten to `/api/...` (see `next.config.ts`) so rendered MP4s and uploads stream through Next.

### Client (`src/client/`)

Studio UI (tabs, job history, settings) under `components/`, with `hooks/` and `lib/` (including `lib/desktop.ts` for the `window.desktop` calls). React Query is the data layer.

### Pipeline standalone packaging

`next.config.ts` sets `output: "standalone"` so Electron can run `node .next/standalone/server.js` as a managed child. Two non-obvious bits:

- `outputFileTracingExcludes` keeps dev `runtime/jobs.json` out of the traced bundle.
- `turbopack.root = __dirname` pins the tracing root so the standalone tree lands at `.next/standalone/server.js` and not a nested host-repo subpath. Without this `electron/server-manager.cjs` cannot find the entry.
- `scripts/prepare-standalone.cjs` copies `public/` and `.next/static/` into the standalone tree (Next omits them by design).
- `forge.config.cjs` `asar.unpack`s `ffmpeg-static`, `ffprobe-static`, and the entire standalone tree — spawning a binary from inside `app.asar` `ENOTDIR`s.

## Conventions

- **TypeScript path alias**: `@/*` → `src/*`.
- **Tests**: Vitest + jsdom + `@testing-library/react`. Setup file `src/test/setup.ts`. The `**/.next/**` exclude in `vitest.config.ts` is load-bearing — the standalone copy of `src/test/**` would otherwise run every test twice.
- **CSS source of truth**: `src/app/globals.css`. Grep for an existing canonical class before adding a new BEM `__`-style name; unmatched classes render unstyled. See `docs/CSS_CONVENTIONS.md`.
- **IPC pattern**: Promise-based `ipcMain.handle` + `ipcRenderer.invoke` only. No legacy `ipcMain.on` / `ipcRenderer.send`. One narrow `window.desktop.<channel>` wrapper per channel — never expose `ipcRenderer` itself.
- **Catalog/R2 mental model**: `readCatalog()` / `writeCatalog()` are always local. R2 is a sidecar; the Worker mints short-lived S3 creds; the app stores no permanent R2 API keys.
- **Commits**: `type(scope): subject` in imperative mood (`fix`, `feat`, `chore`, `docs`, `refactor`, `test`). Release commits bump `package.json` and `package-lock.json` together and push branch + tag together (see `docs/RELEASE_CONVENTION.md`). Never auto-commit — draft a message and let the user invoke it.
- **Doc-only** changes → `docs(scope): subject`. Pure refactors → `refactor(scope): subject`.

## Safety rules (do not regress)

- Do **not** remove desktop auth checks from mutating handlers — `src/proxy.ts` is a perimeter, not the only guard.
- Do **not** trust `instrumentation.ts` as the packaged desktop ffmpeg gate.
- Do **not** use ephemeral ports for the Electron child server; keep the `3765` + fallbacks contract.
- Do **not** move `ffmpeg-static`/`ffprobe-static` back inside `app.asar`.
- Do **not** store API keys in renderer `localStorage` — use main-process `safeStorage`.
- Do **not** substitute `localhost` for `127.0.0.1` in child-server config (macOS may resolve to `::1`).
- Do **not** call `shell.openExternal(url)` on renderer-provided URLs without `https:` + host allowlist.
- Do **not** reintroduce legacy IPC patterns or expose `ipcRenderer` itself via `contextBridge`.
- Do **not** mix generated runtime artifacts (`runtime/`, fixtures) into release commits unless the user explicitly asks.
- Do **not** upload rendered `forecast_<jobId>.mp4` outputs to R2. Renders stay local; `uploadR2File` throws on any `outputs/` key as a defense-in-depth guard. R2 mirrors catalog/videos/posters/voiceovers only.
- Keep Electron renderer security: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`.

## Environment variables

Required: `OPENAI_API_KEY` (Whisper + GPT picker). Optional: `GEMINI_API_KEY` (vision; falls back to GPT-4o-mini), `FFMPEG_PATH`/`FFPROBE_PATH`, `PORT`/`HOSTNAME`, `WEATHER_WORKSPACE_DIR`, and the `R2_*` family (`R2_SYNC_ENABLED`, `R2_GATEWAY_URL`, `R2_TENANT_ID`, `R2_BUCKET_NAME`, `R2_APP_USERNAME`, `R2_APP_PASSWORD`). Full reference: `.env.example` and `src/server/runtime/config.ts`.

## CI / release workflows

- `.github/workflows/desktop.yml` — runs `electron-forge make --arch=x64` on macOS and Windows for `v*` tags; uploads `desktop-macos-latest`, `desktop-windows-latest`, and a tiny `release-ref` artifact carrying the tag name.
- `.github/workflows/desktop-publish-release.yml` — `workflow_run`-triggered; downloads artifacts from the matching Desktop run and attaches **`WeatherV1-macOS.zip`** and **`WeatherV1-Setup.exe`** to the GitHub Release. Stable latest URLs only work when the latest release is non-draft, non-prerelease, with those exact asset names.
- `.github/workflows/pitch-deck.yml` — deploys the download/pitch-deck page (`docs/download-page/`) to Cloudflare Pages (`weatherv1-download.pages.dev`) via `cloudflare/wrangler-action`.
- `.github/workflows/ci.yml` — standard CI.

For a release, prefer the `weatherv1-release` skill, which drives preflight → version bump → tag/push → workflow watch → asset verification end-to-end.
