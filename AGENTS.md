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
5. For Electron work, read `docs/ELECTRON_AGENT_GUIDE.md` for the main/preload/renderer mental model and the routine pitfalls.

## Setup Commands

```bash
nvm use 20            # Node 20+ required
npm install            # uses npm; do not switch to pnpm/yarn (lockfile mismatch)
cp .env.example .env   # then fill in OPENAI_API_KEY (required) and others
npm run dev            # web dev server, http://localhost:3000
npm run electron:dev   # Electron shell with managed Next child, http://127.0.0.1:3765
```

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

## Commit and PR Instructions

- Commit style: `type(scope): subject` (`fix`, `feat`, `chore`, `docs`, `refactor`, `test`). Subject in imperative mood. Example: `chore(release): v0.3.3`.
- Release commits: bump `package.json` and `package-lock.json` in the same commit as the tagged change. Tag and branch must be pushed together. See `docs/RELEASE_CONVENTION.md` for the full procedure.
- Never auto-commit. Surface a draft message to the user and let them invoke the commit.
- Do not mix unrelated dirty files into a release commit. If unrelated user changes are present, list them and ask before including them.
- Doc-only changes use `docs(scope): subject`. Pure refactors with no behavior change use `refactor(scope): subject`.

## Safety Rules

- Do not remove desktop auth checks from mutating handlers. `src/proxy.ts` is a perimeter, not the only guard.
- Do not trust `instrumentation.ts` as the packaged desktop ffmpeg gate.
- Do not use ephemeral ports for the Electron child server.
- Do not move ffmpeg/ffprobe back inside `app.asar`.
- Do not store API keys in renderer `localStorage`.
- Do not mix generated runtime artifacts into release commits unless the user explicitly asks for fixture updates.
- Do not invent new CSS class names for renderer components without consulting `docs/CSS_CONVENTIONS.md`. The styling source of truth is `src/app/globals.css`; new BEM `__`-style names without matching CSS render unstyled.
- Do not reintroduce legacy IPC. New IPC channels must use `ipcMain.handle` + `ipcRenderer.invoke`. Background: `docs/ELECTRON_AGENT_GUIDE.md`.
- Do not expose `ipcRenderer` itself via `contextBridge`. Add one narrow wrapper per channel under `window.desktop` (`electron/preload.cjs`).
- Do not call `shell.openExternal(url)` on a renderer-provided URL without scheme + host validation. Limit to `https:` against a known allowlist.
- Do not substitute `localhost` for `127.0.0.1` in child-server config. `electron/config.cjs:24` binds IPv4 loopback explicitly; macOS may otherwise resolve `localhost` to `::1`.
