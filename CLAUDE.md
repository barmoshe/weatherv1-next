# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Heads up: Next.js 16

This repo runs **Next.js 16** with React 19. APIs, conventions, and file structure may differ from your training data. Before writing route handlers, middleware, instrumentation, config, or anything touching Next behavior, read the matching file under `node_modules/next/dist/docs/`. Heed deprecation notices.

## Start here for substantial work

1. `docs/PROJECT_GOAL.md` — current goal, "Done means", invariants.
2. `docs/DOCS_INDEX.md` — task-to-doc router and code map (canonical home).
3. For Electron work: `docs/ELECTRON.md`.
4. For R2/Worker/Pulumi: `docs/R2_PULUMI_HANDOFF.md` + `infra/cloudflare/README.md`.
5. For releases: `docs/RELEASE_CONVENTION.md` (or `/weatherv1-release`).
6. For goal-driven sessions: `/weatherv1-goal`.
7. For handoff format + agent workflow conventions: `docs/CLAUDE_PRACTICES.md`. Write `.claude/HANDOFF-YYYY-MM-DD-<topic>.md` when pausing multi-phase work mid-flight.

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

**Verification defaults:**
- Server/runtime changes → `npx tsc --noEmit` + `npm test`.
- Next route or build behavior → also `npm run build`.
- Electron startup/package changes → also `npm run standalone:prep` and, when feasible, `npm run electron:build`.

## Architecture (one paragraph)

WeatherV1 is a **local-first pipeline**: audio MP3 → OpenAI Whisper → scene planner → pick clips from a local catalog → ffmpeg renders a 9:16 MP4. The same Next.js app runs in two runtimes — **web/server** (long-lived Node + native ffmpeg) and **desktop** (Electron shell supervising a `fork()`-spawned Next standalone child on `127.0.0.1:3765`, bundled ffmpeg, per-launch session-token auth on `/api/*`). Switching is driven by runtime detection in `src/server/runtime/`; most code under `src/server/**` and `src/app/**` is runtime-agnostic.

Code map and per-folder roles: [`docs/DOCS_INDEX.md`](docs/DOCS_INDEX.md). Electron process model + sharp edges: [`docs/ELECTRON.md`](docs/ELECTRON.md). R2 sidecar: [`docs/R2_PULUMI_HANDOFF.md`](docs/R2_PULUMI_HANDOFF.md).

## Conventions

- **TypeScript path alias**: `@/*` → `src/*`.
- **Tests**: Vitest + jsdom + `@testing-library/react`. Setup file `src/test/setup.ts`. The `**/.next/**` exclude in `vitest.config.ts` is load-bearing — the standalone copy of `src/test/**` would otherwise run every test twice.
- **CSS source of truth**: `src/app/globals.css`. Grep for an existing canonical class before adding a new BEM `__`-style name; unmatched classes render unstyled. See `docs/CSS_CONVENTIONS.md`.
- **IPC pattern**: Promise-based `ipcMain.handle` + `ipcRenderer.invoke` only. No legacy `ipcMain.on` / `ipcRenderer.send`. One narrow `window.desktop.<channel>` wrapper per channel — never expose `ipcRenderer` itself.
- **Catalog/R2 mental model**: `readCatalog()` / `writeCatalog()` are always local. R2 is a sidecar; the app talks to the R2 gateway Worker (`/v1/objects` for single PUTs/GETs, `/v1/multipart/*` for files >90 MB) via HTTP Basic auth using the unified `EDITOR_PASSWORD`. No S3 SDK in the app, no temp credentials in flight, no permanent R2 keys on disk. Rotate Worker secrets via [`docs/RUNBOOK_WORKER_ROTATION.md`](docs/RUNBOOK_WORKER_ROTATION.md).
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

- `.github/workflows/desktop.yml` — Windows-only `electron-forge make --arch=x64` on `v*` tags; uploads `desktop-windows-latest` and a tiny `release-ref` artifact carrying the tag name. macOS is **not** built in CI (see `docs/RELEASE_CONVENTION.md` for the local Mac build).
- `.github/workflows/desktop-publish-release.yml` ("Desktop publish to R2") — `workflow_run`-triggered after Desktop; uploads `WeatherV1-Setup.exe` to R2 via the S3 API at `tenants/<tenantId>/downloads/windows/{latest,<tag>}/`. Nothing is attached to the GitHub Release. Public URLs are served by the Worker at `https://<worker-host>/downloads/windows/{latest,<tag>}/WeatherV1-Setup.exe`.
- `.github/workflows/pitch-deck.yml` — deploys the download/pitch-deck page (`docs/download-page/`) to Cloudflare Pages (`weatherv1-download.pages.dev`).
- `.github/workflows/ci.yml` — standard CI.

For a release, prefer the `weatherv1-release` skill, which drives preflight → version bump → tag/push → workflow watch → asset verification end-to-end.
