---
name: weatherv1-goal
description: Route WeatherV1 work from a clear goal to the right docs, files, checks, and release workflow. Use when starting substantial work, resuming after compaction, preparing a release, or making the repo easier for AI agents to navigate.
---

# WeatherV1 Goal Router

Use this skill to align on the active goal before changing code.

## Load Order

1. Read `docs/PROJECT_GOAL.md`.
2. Read `docs/DOCS_INDEX.md`.
3. If this is desktop or release work, read `docs/ELECTRON.md` and `docs/RELEASE_CONVENTION.md`.
4. If this is cloud/server work, read `docs/DESIGN_DEPLOYMENT.md`.
5. If this touches R2, the Worker, or Pulumi, read `docs/R2_PULUMI_HANDOFF.md` and `infra/cloudflare/README.md`.
6. If this touches Next.js behavior, read the relevant guide under `node_modules/next/dist/docs/`.

## Goal Shape

Restate the task as:

- desired end state
- files or subsystems likely involved
- verification commands
- release or manual smoke checks, if any

For long work in Claude Code, suggest a built-in `/goal` condition that can be evaluated from the transcript. Make the condition measurable: command exits, asset names exist, release workflow succeeds, or a file contains a specific section.

## Default Checks

- `npx tsc --noEmit`
- `npm test`
- `npm run build` for Next route/build changes
- `npm run electron:build` for Electron startup/package changes

## Release Checks

For desktop releases, follow `docs/RELEASE_CONVENTION.md` exactly:

- bump `package.json` and `package-lock.json` together
- create the next `v*` tag
- push `main` and the tag
- watch Desktop and Desktop publish to R2
- verify `https://<worker-host>/downloads/windows/{latest,<tag>}/WeatherV1-Setup.exe` both return 200 (macOS is built locally only)

## Response Rule

Before implementation, briefly name the active goal and the proof you will collect. After implementation, report the proof and any remaining manual checks.
