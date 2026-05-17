# Documentation Index

The fastest way to orient in `weatherv1-next`. Use this as the docs router before reading deeper notes.

## What this project is

A local-first weather-video production app: narration → Whisper transcript → scene-planned against a local catalog → 9:16 ffmpeg render. Same app runs in two runtimes:

- **Web/server** — long-lived Node host or Docker VM with native ffmpeg.
- **Desktop** — Electron shell around a managed local Next child server, user-chosen workspace, bundled ffmpeg.

**Optional Cloudflare R2** mirrors catalog JSON, videos, posters, and voiceovers through a Worker gateway. ffmpeg and the hot catalog path stay local; R2 is a sidecar. Rendered forecast MP4s are intentionally **not** mirrored — they are regenerable from the plan bundle and `uploadR2File` rejects any `outputs/` key.

## Read this first

1. [PROJECT_GOAL.md](PROJECT_GOAL.md) — current product/engineering goal, "Done means" checklist, invariants.
2. [../README.md](../README.md) — public intro, quick start, repo map.
3. [../CLAUDE.md](../CLAUDE.md) — full Claude-facing project guide (commands, architecture pointer, safety rules, env, CI).
4. [../AGENTS.md](../AGENTS.md) — short pointer for agents.

## Pick the right doc by task

| If you need to… | Read | Then inspect |
| --- | --- | --- |
| Understand the product and run it locally | [../README.md](../README.md) | `src/app`, `src/client`, `src/server` |
| Start substantial multi-step work | [PROJECT_GOAL.md](PROJECT_GOAL.md), invoke `/weatherv1-goal` | `.claude/skills/weatherv1-goal/SKILL.md` |
| Modify or reason about Electron (main, preload, renderer, IPC, packaging, releases) | [ELECTRON.md](ELECTRON.md) | `electron/`, `forge.config.cjs`, `src/proxy.ts`, `src/shared/desktop.ts` |
| Change desktop UI flows | [CSS_CONVENTIONS.md](CSS_CONVENTIONS.md) (renderer styling source of truth); [ELECTRON.md](ELECTRON.md) (process model) | `src/client/components/**`, `src/client/lib/desktop.ts`, `src/app/globals.css` |
| Edit Hebrew pitch-deck slide content | [SLIDES.md](SLIDES.md), [`download-page/slides-content.md`](download-page/slides-content.md) | `docs/download-page/index.html.template` |
| Work on R2, Worker, or Pulumi infra | [R2_PULUMI_HANDOFF.md](R2_PULUMI_HANDOFF.md), [CLOUDFLARE_INTEGRATION.md](CLOUDFLARE_INTEGRATION.md), [../infra/cloudflare/README.md](../infra/cloudflare/README.md) | `src/server/sync/r2/`, `src/app/api/sync/r2/`, `infra/cloudflare/` |
| Rotate Worker secrets after EDITOR_PASSWORD changes | [RUNBOOK_WORKER_ROTATION.md](RUNBOOK_WORKER_ROTATION.md) | `.github/workflows/rotate-worker-secrets.yml`, `infra/cloudflare/wrangler.toml` |
| Package or ship a desktop release | [RELEASE_CONVENTION.md](RELEASE_CONVENTION.md), or invoke `/weatherv1-release` | `.github/workflows/desktop*.yml`, `forge.config.cjs` |
| Add CSS class names to renderer components | [CSS_CONVENTIONS.md](CSS_CONVENTIONS.md) | `src/app/globals.css` (source of truth) |
| Deploy the web/server version | [DESIGN_DEPLOYMENT.md](DESIGN_DEPLOYMENT.md) | `Dockerfile`, `docker-compose.yml`, `src/server/**` |
| Swap LLM / transcription providers | [PROVIDERS.md](PROVIDERS.md) | `src/server/providers/` |
| Pack the repo into Markdown for NotebookLM briefings | [NOTEBOOKLM.md](NOTEBOOKLM.md) | `npm run notebooklm:export:chunks` |
| Edit the pitch-deck / download-page copy | `docs/download-page/index.html.template` directly | `storySections` + visual builders inside the template |
| Rotate or add a project secret | [`../infra/cloudflare/README.md`](../infra/cloudflare/README.md#secrets-ownership--rotation) (live inventory + rotation), [`archive/SECRETS_MANAGEMENT_AUDIT.md`](archive/SECRETS_MANAGEMENT_AUDIT.md) (umbrella plan) | `.github/workflows/`, `infra/cloudflare/Pulumi.dev.yaml` |

## Queued and historical work

- **Queued tasks** — see [`future/README.md`](future/README.md). Each file is self-contained (Goal / Plan / Verification). When a task ships, move its file to [`archive/`](archive/) and update this index.
- **Archived docs** — see [`archive/README.md`](archive/README.md). Historical/completed; not authoritative.

## Code map

| Path | Role |
| --- | --- |
| `src/app/` | Next App Router UI and route handlers |
| `src/app/globals.css` | Styling source of truth — canonical class names for modals, fields, buttons, catalog grid |
| `src/client/` | Studio UI components and browser/desktop renderer helpers |
| `src/server/catalog/` | Catalog parsing and persistence |
| `src/server/sync/r2/` | Cloudflare R2 catalog/media sidecar sync |
| `src/server/ffmpeg/` | Probe, binary resolution, preview/poster generation, render pipeline |
| `src/server/jobs/` | Job queue, store, worker lifecycle |
| `src/server/pipeline/` | Scene planning + picking; picks carry `picker_reason` (LLM editorial) and `reason` (post-validator) |
| `src/server/providers/` | Pluggable LLM (Anthropic/OpenAI) + OpenAI Whisper provider + unified error mapping |
| `src/server/runtime/` | Runtime config, derived paths, desktop auth, R2 env |
| `src/shared/` | Cross-boundary types shared by preload and renderer |
| `electron/` | Electron main / preload / config / server-manager / ffmpeg verify |
| `infra/cloudflare/` | Pulumi-managed R2 bucket + Worker gateway |
| `scripts/` | Standalone prep, Electron launch, R2-related CLIs |
| `.github/workflows/` | CI, desktop packaging, release publishing, Pages |
| `.claude/skills/` | Project skills for goal routing and repeatable workflows |

## Source-of-truth rules

- [PROJECT_GOAL.md](PROJECT_GOAL.md) is the active goal and invariants file. Update it when "done" changes.
- [R2_PULUMI_HANDOFF.md](R2_PULUMI_HANDOFF.md) carries R2 implementation status; [`../infra/cloudflare/README.md`](../infra/cloudflare/README.md) carries Pulumi operator steps.
- [DESIGN_DEPLOYMENT.md](DESIGN_DEPLOYMENT.md) is the rationale for Dockerfile/compose/mounts.
- [ELECTRON.md](ELECTRON.md) is the single Electron reference — architecture, file map, pitfalls, sharp edges, release path.
- `../README.md` should stay short enough to onboard a new reader quickly; deeper edge cases belong in specialized docs.
- `src/app/globals.css` is the only styling source of truth for renderer components. New BEM `__`-style names without matching CSS render unstyled — see [CSS_CONVENTIONS.md](CSS_CONVENTIONS.md).

## Terms

| Term | Meaning |
| --- | --- |
| `workspace` | User-chosen desktop media root used by Electron mode |
| `v1Drive` | Historical local media tree used by the earlier/server layout |
| `runtime/` | Generated local state: jobs, uploads, outputs, caches, `r2-sync-state.json` |
| `desktop perimeter` | The proxy + token + in-handler auth model protecting local desktop routes |
| `standalone` | Next production output under `.next/standalone/` used by Electron packaging |
| `tenantKey(rel)` | Prefixes object keys as `tenants/<tenantId>/` + `rel` for R2 (see `src/server/sync/r2/client.ts`) |
