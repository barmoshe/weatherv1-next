# Project Goal

This is the canonical goal file for humans and AI agents working in `weatherv1-next`.
Read it before large changes, release work, or any task where the desired end state is bigger than a single obvious edit.

## Current Product Goal

WeatherV1 is a local-first weather video production app. It turns recorded narration into a transcribed, scene-planned, ffmpeg-rendered 9:16 forecast video using a local media catalog.

The project must stay useful in two runtimes:

- **Desktop:** Electron shell around a managed local Next server, user-chosen workspace, native pickers, bundled ffmpeg, GitHub-built installers.
- **Server/Web:** Long-lived Node host or Docker VM with persistent disk and native ffmpeg.

## Current Engineering Goal

Ship a reliable desktop alpha that a non-developer can install, open, point at a prepared local workspace, enter an API key, transcribe audio, import catalog video, and render output without touching the repo.

## Done Means

- `npx tsc --noEmit` passes.
- `npm test` passes.
- `npm run build` produces `.next/standalone/server.js`.
- Electron startup does not crash if macOS `activate` fires before or after bootstrap.
- Packaged child-server failures include useful diagnostics from `next-child.log`.
- A `v*` tag creates macOS and Windows installer artifacts in GitHub Actions.
- The release publisher attaches `WeatherV1-macOS.zip` and `WeatherV1-Setup.exe`.
- Docs explain the current goal, release procedure, and known smoke-test gaps.

## Non-Goals For Now

- Google Drive-backed asset provider implementation.
- Staged/delta updates.
- Rewriting the Next renderer as a pure IPC-native app.
- Public signed/notarized distribution before Apple and Windows signing secrets are configured.

## Invariants

- Keep the existing `/api/*` renderer contract unless a task explicitly changes it.
- Keep local media access behind the runtime config and asset-source boundary.
- Keep desktop session-token auth in both `src/proxy.ts` and mutating handlers.
- Keep Electron renderer security settings locked down: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`.
- Keep the desktop child server on deterministic loopback ports: `3765`, then `3766`, `3767`, `3768`.

## Suggested `/goal` Conditions

Use these as copy-ready completion conditions when running a long agent session:

```text
/goal Electron desktop startup is fixed and verified: npx tsc --noEmit exits 0, npm test exits 0, npm run electron:build exits 0, and the final answer reports any remaining manual packaged-app checks.
```

```text
/goal A new desktop release is published: v0.1.x exists locally and on origin, the Desktop workflow succeeds for the tag, Desktop publish release succeeds, and the GitHub Release contains WeatherV1-macOS.zip and WeatherV1-Setup.exe.
```

```text
/goal Documentation is AI-native: AGENTS.md, docs/DOCS_INDEX.md, docs/PROJECT_GOAL.md, README.md, and relevant specialist docs route agents to the correct source of truth with verification commands.
```

## Maintenance Rule

When architecture, release flow, or runtime assumptions change, update this file and the relevant specialist doc in the same commit.
