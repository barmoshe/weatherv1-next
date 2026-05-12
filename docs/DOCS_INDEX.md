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

## Read this first

1. [README.md](/Users/barmoshe/claude-creative-stack/weatherv1-next/README.md)
   For product overview, quick start, and the high-level repo map.
2. [AGENTS.md](/Users/barmoshe/claude-creative-stack/weatherv1-next/AGENTS.md)
   For project-specific guardrails, especially around modern Next.js behavior.
3. The doc for your task:
   - desktop architecture: [ELECTRON_DESKTOP_PLAN.md](/Users/barmoshe/claude-creative-stack/weatherv1-next/docs/ELECTRON_DESKTOP_PLAN.md)
   - desktop operational state: [ELECTRON_DESKTOP_HANDOFF.md](/Users/barmoshe/claude-creative-stack/weatherv1-next/docs/ELECTRON_DESKTOP_HANDOFF.md)
   - desktop UX guidance: [ELECTRON_UXUI_RESEARCH.md](/Users/barmoshe/claude-creative-stack/weatherv1-next/docs/ELECTRON_UXUI_RESEARCH.md)
   - server/cloud deployment: [DESIGN_DEPLOYMENT.md](/Users/barmoshe/claude-creative-stack/weatherv1-next/docs/DESIGN_DEPLOYMENT.md), [DEPLOY_ORACLE_CLOUD.md](/Users/barmoshe/claude-creative-stack/weatherv1-next/docs/DEPLOY_ORACLE_CLOUD.md)
   - repo history / extraction context: [HANDOFF_NEW_REPO.md](/Users/barmoshe/claude-creative-stack/weatherv1-next/docs/HANDOFF_NEW_REPO.md)

## Pick the right doc by task

| If you need to... | Read this first | Then inspect code here |
| --- | --- | --- |
| Understand the product and run it locally | [README.md](/Users/barmoshe/claude-creative-stack/weatherv1-next/README.md) | `src/app`, `src/client`, `src/server` |
| Modify Electron behavior | [ELECTRON_DESKTOP_HANDOFF.md](/Users/barmoshe/claude-creative-stack/weatherv1-next/docs/ELECTRON_DESKTOP_HANDOFF.md) | `electron/`, `forge.config.cjs`, `src/shared/desktop.ts` |
| Understand why Electron was designed this way | [ELECTRON_DESKTOP_PLAN.md](/Users/barmoshe/claude-creative-stack/weatherv1-next/docs/ELECTRON_DESKTOP_PLAN.md) | `electron/`, `src/server/runtime`, `src/proxy.ts` |
| Change desktop UI flows | [ELECTRON_UXUI_RESEARCH.md](/Users/barmoshe/claude-creative-stack/weatherv1-next/docs/ELECTRON_UXUI_RESEARCH.md) | `src/client/components/**`, `src/client/lib/desktop.ts` |
| Package or release installers | [ELECTRON_DESKTOP_HANDOFF.md](/Users/barmoshe/claude-creative-stack/weatherv1-next/docs/ELECTRON_DESKTOP_HANDOFF.md) | `.github/workflows/desktop*.yml`, `forge.config.cjs`, `build/` |
| Deploy the web/server version | [DESIGN_DEPLOYMENT.md](/Users/barmoshe/claude-creative-stack/weatherv1-next/docs/DESIGN_DEPLOYMENT.md) | `Dockerfile`, `docker-compose.yml`, `src/server/**` |
| Do the actual Oracle Cloud setup | [DEPLOY_ORACLE_CLOUD.md](/Users/barmoshe/claude-creative-stack/weatherv1-next/docs/DEPLOY_ORACLE_CLOUD.md) | `Dockerfile`, `docker-compose.yml`, `.env.example` |
| Understand historical monorepo assumptions | [HANDOFF_NEW_REPO.md](/Users/barmoshe/claude-creative-stack/weatherv1-next/docs/HANDOFF_NEW_REPO.md) | old sibling-path notes in `src/server/**` |

## Code map

| Path | Role |
| --- | --- |
| `src/app/` | Next App Router UI and route handlers |
| `src/client/` | Studio UI components and browser/desktop renderer helpers |
| `src/server/catalog/` | Catalog parsing and persistence |
| `src/server/ffmpeg/` | Probe, binary resolution, preview/poster generation, render pipeline |
| `src/server/jobs/` | Job queue, store, worker lifecycle |
| `src/server/pipeline/` | Planning and scene-selection logic |
| `src/server/runtime/` | Runtime config, derived paths, desktop auth |
| `src/shared/` | Cross-boundary types shared by preload and renderer |
| `electron/` | Electron main/preload/config/server-manager/ffmpeg verify |
| `scripts/` | Standalone prep and Electron launch helpers |
| `.github/workflows/` | CI, packaging, release publishing, Pages |
| `docs/` | Design, handoff, deployment, and release docs |

## Source-of-truth rules

- Desktop architecture and current state are split on purpose:
  - `ELECTRON_DESKTOP_PLAN.md` explains **why** the system is shaped this way.
  - `ELECTRON_DESKTOP_HANDOFF.md` explains **what is currently implemented** and **what still needs real-world validation**.
- For server/cloud deploys:
  - `DESIGN_DEPLOYMENT.md` is the architecture rationale.
  - `DEPLOY_ORACLE_CLOUD.md` is the operator playbook.
- `README.md` should stay short enough to onboard a new reader quickly; deeper edge cases belong in the specialized docs.

## Agent workflow

When changing code here, the safest path is:

1. read `AGENTS.md`
2. read this index
3. open the most relevant doc above
4. inspect the exact code paths named by that doc
5. only then change implementation

For Next.js behavior, do not rely on memory alone. Read the relevant docs under `node_modules/next/dist/docs/` first, because this repo is on a newer Next line with breaking changes.

## Terms

| Term | Meaning in this repo |
| --- | --- |
| `workspace` | User-chosen desktop media root used by Electron mode |
| `v1Drive` | Historical local media tree used by the earlier/server layout |
| `runtime/` | Generated local state such as jobs, uploads, outputs, and caches |
| `desktop perimeter` | The proxy + token + in-handler auth model protecting local desktop routes |
| `standalone` | Next production output under `.next/standalone/` used by Electron packaging |
