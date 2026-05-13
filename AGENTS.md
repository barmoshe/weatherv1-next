<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# WeatherV1 Agent Guide

Use this file as the short operational map for AI agents. Keep broad product context in `README.md`, route-finding in `docs/DOCS_INDEX.md`, and long procedures in task-specific docs or `.claude/skills/**/SKILL.md`.

## Start Here

1. Read `docs/PROJECT_GOAL.md` to understand the current product goal and completion criteria.
2. Read `docs/DOCS_INDEX.md` to choose the right specialist doc.
3. Inspect the code paths named by that doc before making changes.
4. For Next.js behavior, read the matching file under `node_modules/next/dist/docs/` before editing.

## Goal Workflow

- For substantial multi-step work, define or restate a measurable goal before implementation.
- In Claude Code, use the built-in `/goal` command with a verifiable condition.
- For project-specific goal routing, invoke `/weatherv1-goal` from `.claude/skills/weatherv1-goal/SKILL.md`.
- Good goal conditions name the expected proof, such as `npm test exits 0`, `npx tsc --noEmit exits 0`, or a GitHub release page showing both installer assets.

## Common Commands

```bash
npm test
npx tsc --noEmit
npm run build
npm run standalone:prep
npm run electron:dev
npm run electron:build
npm run electron:make
```

## Verification Defaults

- For server/runtime changes: run `npx tsc --noEmit` and `npm test`.
- For Next route or build behavior: also run `npm run build`.
- For Electron startup/package changes: also run `npm run standalone:prep` and, when feasible, `npm run electron:build`.
- For release work: follow `docs/RELEASE_CONVENTION.md`.

## Safety Rules

- Do not remove desktop auth checks from mutating handlers. `src/proxy.ts` is a perimeter, not the only guard.
- Do not trust `instrumentation.ts` as the packaged desktop ffmpeg gate.
- Do not use ephemeral ports for the Electron child server.
- Do not move ffmpeg/ffprobe back inside `app.asar`.
- Do not store API keys in renderer `localStorage`.
- Do not mix generated runtime artifacts into release commits unless the user explicitly asks for fixture updates.
- Do not invent new CSS class names for renderer components without adding matching rules. The styling source of truth is `src/app/globals.css`. Reuse the canonical patterns it already defines (modal: `modal` / `modal-backdrop` / `modal-dialog` / `modal-header` / `modal-title` / `modal-body` / `modal-close` / `modal-footer`; forms: `field` + `field-label` with bare `textarea`/`select`; segment editor: `segment-block` / `segment-thumb` / `segment-header` / `segment-time` / `segment-desc-input` / `segment-tags-input`; buttons: `btn` + `btn--primary` / `btn--secondary` / `btn--danger` / `btn--ghost` / `btn--sm`). BEM `__`-style names have no CSS in this repo and will render unstyled.
