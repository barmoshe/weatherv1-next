# Project Goal

This is the canonical goal file for humans and AI agents working in `weatherv1-next`.
Read it before large changes, release work, or any task where the desired end state is bigger than a single obvious edit.

## Current Product Goal

WeatherV1 is a local-first weather video production app. It turns recorded narration into a transcribed, scene-planned, ffmpeg-rendered 9:16 forecast video using a local media catalog, with optional Cloudflare R2 sync for catalog/media assets.

R2 is documented end-to-end in [`docs/R2_PULUMI_HANDOFF.md`](R2_PULUMI_HANDOFF.md) (app sync, Worker auth, live status) and [`infra/cloudflare/README.md`](../infra/cloudflare/README.md) (Pulumi). The docs router is [`docs/DOCS_INDEX.md`](DOCS_INDEX.md) → section *Cloudflare R2 (optional cloud mirror)*.

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
- Optional R2 sync can reach the deployed Worker gateway, mint short-lived credentials, push/pull the catalog, and materialize cloud-only videos back to local disk.
- Docs explain the current goal, release procedure, and known smoke-test gaps.

## Non-Goals For Now

- Browser-direct R2 uploads; desktop/server-side sync owns v1 uploads.
- Multi-tenant hosted SaaS storage beyond the single-tenant prefix model.
- Staged/delta updates.
- Rewriting the Next renderer as a pure IPC-native app.
- Public signed/notarized distribution before Apple and Windows signing secrets are configured.

## Invariants

- Keep the existing `/api/*` renderer contract unless a task explicitly changes it.
- Keep local media access behind the runtime config and asset-source boundary.
- Keep R2 sync as a sidecar around the local catalog; do not make ffmpeg depend on remote URLs.
- Do not ship permanent R2 credentials in Electron. Use the Worker gateway to mint short-lived, tenant-scoped credentials.
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

```text
/goal Cloudflare R2 sync is production-smoked: Pulumi stack outputs the real Worker URL, /v1/health succeeds, temporary credentials mint for tenant default, the v1Drive catalog is uploaded, and an Electron pull/materialize flow is manually verified.
```

## Maintenance Rule

When architecture, release flow, or runtime assumptions change, update this file and the relevant specialist doc in the same commit.
