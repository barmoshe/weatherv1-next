# Documentation Index

This file is the fastest way for a human or agent to orient in `weatherv1-next`.
Use it as the docs router before reading deeper implementation or deployment notes.

## What this project is

`weatherv1-next` is a local-first weather-video production app:

1. ingest recorded narration
2. transcribe it
3. plan scenes against a local media catalog
4. render a 9:16 forecast video with ffmpeg

The same product can run in two modes:

- **Web/server mode** on a single long-lived Node host or Docker VM
- **Desktop mode** inside Electron with a managed local Next child

**Optional Cloudflare R2:** catalog JSON, videos, posters, voiceovers, and outputs can mirror to R2 through a Worker gateway (see [Cloudflare R2 (optional cloud mirror)](#cloudflare-r2-optional-cloud-mirror) below). ffmpeg and the hot catalog path stay local; R2 is a sidecar.

## Read this first

1. [PROJECT_GOAL.md](PROJECT_GOAL.md) — product intent, success criteria, invariants, copy-ready `/goal` conditions.
2. [README.md](../README.md) — overview, quick start, high-level repo map.
3. [AGENTS.md](../AGENTS.md) — project guardrails, especially modern Next.js behavior.
4. [NOTEBOOKLM.md](NOTEBOOKLM.md) — pack the repo into Markdown for Google NotebookLM (`npm run notebooklm:export:chunks`).
5. The doc for your task:
   - **R2 / Worker / Pulumi / catalog mirror:** [R2_PULUMI_HANDOFF.md](R2_PULUMI_HANDOFF.md) and [infra/cloudflare/README.md](../infra/cloudflare/README.md)
   - **Desktop architecture:** [ELECTRON_DESKTOP_PLAN.md](ELECTRON_DESKTOP_PLAN.md)
   - **Desktop operational state:** [ELECTRON_DESKTOP_HANDOFF.md](ELECTRON_DESKTOP_HANDOFF.md)
   - **Catalog segment tagging** (posters + tags + empty segments): [CATALOG_TAGGING_HANDOFF.md](CATALOG_TAGGING_HANDOFF.md)
   - **Desktop UX guidance:** [ELECTRON_UXUI_RESEARCH.md](ELECTRON_UXUI_RESEARCH.md)
   - **LLM + transcription providers:** [PROVIDERS.md](PROVIDERS.md)
   - **Server deploy (Docker / long-lived Node):** [DESIGN_DEPLOYMENT.md](DESIGN_DEPLOYMENT.md)
   - **Repo extraction history:** [HANDOFF_NEW_REPO.md](HANDOFF_NEW_REPO.md)

## Cloudflare R2 (optional cloud mirror)

| Topic | Where to read |
| --- | --- |
| Goals, live status, Basic Auth migration, file list | [R2_PULUMI_HANDOFF.md](R2_PULUMI_HANDOFF.md) |
| Cloudflare + Pulumi + MCP improvement plan (worker hardening, ESC, MCP server) | [CLOUDFLARE_MCP_IMPROVEMENT_PLAN.md](CLOUDFLARE_MCP_IMPROVEMENT_PLAN.md) |
| Pulumi config, `pulumi up`, Worker secrets | [infra/cloudflare/README.md](../infra/cloudflare/README.md) |
| Sync client, materialize, push/pull, conflict handling | `src/server/sync/r2/` ([service.ts](../src/server/sync/r2/service.ts) is the orchestration hub) |
| HTTP API for the app | `src/app/api/sync/r2/*` |
| Desktop login + Settings fields for gateway URL / tenant / bucket / Basic Auth | [ELECTRON_DESKTOP_HANDOFF.md](ELECTRON_DESKTOP_HANDOFF.md) (`SettingsModal`, `StorageOnboardingGate`) |
| CLI poster + catalog push after bulk tagging | [CATALOG_TAGGING_HANDOFF.md](CATALOG_TAGGING_HANDOFF.md) (“How the R2 mirror was done from the CLI”) |
| Long clip stuck at one segment (wrong `start_sec`/`end_sec` span) | [CATALOG_TAGGING_HANDOFF.md](CATALOG_TAGGING_HANDOFF.md) — `scripts/repair-long-single-segments.ts` |

**Mental model:** `readCatalog()` / `writeCatalog()` are always local. The Worker mints **short-lived** S3-compatible credentials; the app does not store permanent R2 API keys. Remote-only rows show in the UI; preview/render **materialize** to disk before ffmpeg runs.

**Env (server / desktop child):** see `src/server/runtime/config.ts` — typically `R2_SYNC_ENABLED`, `R2_GATEWAY_URL`, `R2_TENANT_ID`, `R2_BUCKET_NAME`, `R2_APP_USERNAME`, `R2_APP_PASSWORD`.

## Pick the right doc by task

| If you need to... | Read this first | Then inspect code here |
| --- | --- | --- |
| Understand the product and run it locally | [README.md](../README.md) | `src/app`, `src/client`, `src/server` |
| Start a substantial agent task | [PROJECT_GOAL.md](PROJECT_GOAL.md) | `.claude/skills/weatherv1-goal/SKILL.md`, `AGENTS.md` |
| **Work on R2, the Worker gateway, or Pulumi infra** | [R2_PULUMI_HANDOFF.md](R2_PULUMI_HANDOFF.md), [infra/cloudflare/README.md](../infra/cloudflare/README.md) | `src/server/sync/r2`, `src/app/api/sync/r2`, `infra/cloudflare` |
| Modify Electron behavior | [ELECTRON_DESKTOP_HANDOFF.md](ELECTRON_DESKTOP_HANDOFF.md) | `electron/`, `forge.config.cjs`, `src/shared/desktop.ts` |
| Understand why Electron was designed this way | [ELECTRON_DESKTOP_PLAN.md](ELECTRON_DESKTOP_PLAN.md) | `electron/`, `src/server/runtime`, `src/proxy.ts` |
| Change desktop UI flows (including catalog / segment modal) | [ELECTRON_UXUI_RESEARCH.md](ELECTRON_UXUI_RESEARCH.md) §5.6, §4.1 | `src/client/components/catalog/**`, `src/client/lib/desktop.ts`, `src/app/globals.css` |
| Package or release installers | [ELECTRON_DESKTOP_HANDOFF.md](ELECTRON_DESKTOP_HANDOFF.md), [RELEASE_CONVENTION.md](RELEASE_CONVENTION.md) | `.github/workflows/desktop*.yml`, `forge.config.cjs`, `build/` |
| **Reason about Electron main/preload/renderer boundaries, IPC, security** | [ELECTRON_AGENT_GUIDE.md](ELECTRON_AGENT_GUIDE.md) | `electron/main.cjs`, `electron/preload.cjs`, `electron/server-manager.cjs`, `electron/config.cjs`, `forge.config.cjs` |
| Edit pitch / download-page presentation copy | `docs/download-page/index.html.template` directly | `storySections` + visual builders inside the template |
| Deploy the web/server version with Docker | [DESIGN_DEPLOYMENT.md](DESIGN_DEPLOYMENT.md) | `Dockerfile`, `docker-compose.yml`, `src/server/**` |
| Understand historical monorepo assumptions | [HANDOFF_NEW_REPO.md](HANDOFF_NEW_REPO.md) | old sibling-path notes in `src/server/**` |

## Code map

| Path | Role |
| --- | --- |
| `src/app/` | Next App Router UI and route handlers |
| `src/app/globals.css` | Styling source of truth — canonical class names for modals, fields, segment editor, buttons, catalog grid |
| `src/client/` | Studio UI components and browser/desktop renderer helpers |
| `src/server/catalog/` | Catalog parsing and persistence |
| `src/server/sync/r2/` | Cloudflare R2 catalog/media sidecar sync |
| `src/server/ffmpeg/` | Probe, binary resolution, preview/poster generation, render pipeline |
| `src/server/jobs/` | Job queue, store, worker lifecycle |
| `src/server/pipeline/` | Planning and scene-selection logic; timeline picks include **`picker_reason`** (LLM editorial) and **`reason`** (post-validator) for Studio previews |
| `src/server/providers/` | Pluggable LLM (Anthropic/OpenAI) and OpenAI Whisper cloud transcription provider + unified error mapping |
| `src/server/runtime/` | Runtime config, derived paths, desktop auth, **R2 env fields** |
| `src/shared/` | Cross-boundary types shared by preload and renderer |
| `electron/` | Electron main/preload/config/server-manager/ffmpeg verify |
| `infra/cloudflare/` | Pulumi-managed Cloudflare R2 bucket and Worker gateway |
| `scripts/` | Standalone prep, Electron launch, **R2-related CLIs** (`sync-segment-posters.ts`, `prepare-tag-queue.ts`, `apply-segment-tags.ts`, …) |
| `.github/workflows/` | CI, packaging, release publishing, Pages |
| `.claude/skills/` | Project skills for goal routing and repeatable agent workflows |
| `docs/` | Design, handoff, deployment, and release docs |

## Source-of-truth rules

- Desktop architecture and current state are split on purpose:
  - `ELECTRON_DESKTOP_PLAN.md` explains **why** the system is shaped this way.
  - `ELECTRON_DESKTOP_HANDOFF.md` explains **what is currently implemented** and **what still needs real-world validation**.
- **R2** implementation status and operational notes live in `R2_PULUMI_HANDOFF.md`; Pulumi operator steps live in `infra/cloudflare/README.md`.
- For server/cloud deploys of the **Next app process**, `DESIGN_DEPLOYMENT.md` is the architecture rationale (Dockerfile, compose, mounts).
- `README.md` should stay short enough to onboard a new reader quickly; deeper edge cases belong in the specialized docs.
- `PROJECT_GOAL.md` is the active goal and invariants file. Update it when “done” changes.
- `.claude/skills/weatherv1-goal/SKILL.md` is the project-specific goal router. Invoke it as `/weatherv1-goal` in Claude Code.
- `src/app/globals.css` is the only styling source of truth for renderer components. Before adding a new class name to JSX, grep `globals.css` for a canonical equivalent; new BEM `__`-style names without matching rules will render unstyled.

## Agent workflow

When changing code here, the safest path is:

1. read `AGENTS.md`
2. read `docs/PROJECT_GOAL.md`
3. read this index
4. open the most relevant doc above
5. inspect the exact code paths named by that doc
6. only then change implementation

For Next.js behavior, do not rely on memory alone. Read the relevant docs under `node_modules/next/dist/docs/` first, because this repo is on a newer Next line with breaking changes.

## Research-backed agent conventions

- Keep root instructions short and actionable; detailed procedures belong in skills or task docs.
- Use skills for reusable multi-step workflows that should be discoverable on demand.
- Use `/goal`-style completion conditions for substantial work with measurable proof.
- Give agents verification commands, not only intent.

## Terms

| Term | Meaning in this repo |
| --- | --- |
| `workspace` | User-chosen desktop media root used by Electron mode |
| `v1Drive` | Historical local media tree used by the earlier/server layout |
| `runtime/` | Generated local state such as jobs, uploads, outputs, caches, **`r2-sync-state.json`** when R2 is used |
| `desktop perimeter` | The proxy + token + in-handler auth model protecting local desktop routes |
| `standalone` | Next production output under `.next/standalone/` used by Electron packaging |
| `tenantKey(rel)` | Prefixes object keys as `tenants/<tenantId>/` + `rel` for R2 (see `src/server/sync/r2/client.ts`) |
