# Deployment design — weatherV1-next on a single Node host

This document explains the architecture choices behind the `Dockerfile` and `docker-compose.yml` for running the **Next.js app** as a long-lived process on a VM or metal. **Optional Cloudflare R2** (catalog/media mirror) is a separate stack; see [`docs/R2_PULUMI_HANDOFF.md`](R2_PULUMI_HANDOFF.md).

## Why a single-box deploy, not split serverless

The Next.js port is a long-running Node service with five traits that disqualify every "function-as-a-service" host (Vercel, Netlify, Cloudflare Pages, Render free, Fly free tier):

| Trait | Lives in the code at | Conflict with serverless |
|---|---|---|
| Native `ffmpeg` / `ffprobe` child processes | `src/server/ffmpeg/binaries.ts:8`, `spawn.ts:42`, `probe.ts:30`, `renderer.ts:173` | Vercel function size caps at 250 MB unzipped; ffmpeg alone exceeds it. |
| In-memory job queue with a single drain loop | `src/server/jobs/worker.ts:23-51` | Functions are stateless; the queue evaporates between invocations. |
| Local filesystem persistence | `src/server/jobs/store.ts:22`, `worker.ts:20-21`, `runtime/cache/{posters,previews}/` | Vercel filesystem is read-only except ephemeral `/tmp`. |
| Multi-minute encodes inside a request | `renderer.ts:162-185` | Pro + Fluid Compute caps at 800 s; real renders blow past that. |
| Large audio uploads | `src/app/api/transcribe/route.ts` | Vercel body cap is 4.5 MB. |

The simplest fix that preserves the existing code is to run it on a real VM or container host with `ffmpeg` installed and a persistent disk attached. That is what the Dockerfile and compose file deliver.

## Container image structure

Three-stage build in `weatherV1-next/Dockerfile`:

```
deps     →  node:20-bookworm-slim, npm ci (all deps incl. dev)
builder  →  same base, copy src + node_modules from deps, npm run build, npm prune --omit=dev
runner   →  same base + apt-install ffmpeg, copy built artefacts only
```

### Why `node:20-bookworm-slim`

Debian glibc, official multi-arch (`linux/amd64` + `linux/arm64`), small (~80 MB), ships with `node` and a non-root `node` user. Alpine is smaller but uses musl, and ffmpeg + native modules have edge cases under musl (`zlib`, `libstdc++` quirks). For a video pipeline, the few extra MB of Debian aren't worth the troubleshooting risk.

### Why three stages

- `deps` caches `npm ci` (the expensive layer) so it only re-runs when `package-lock.json` changes.
- `builder` does the Next.js compile, then `npm prune --omit=dev` shrinks `node_modules` for the runner.
- `runner` ships only the production deps and the compiled `.next/` output. TypeScript, vitest, and other build tools never reach the runtime image.

### `output: "standalone"`

Enabled in `next.config.ts` — primarily for Electron packaging (`electron/server-manager.cjs` runs `.next/standalone/server.js` as a managed child). The Docker runner stage still copies the full `node_modules` for simplicity; switching it to consume the standalone tree directly would shrink the image from ~250 MB to ~80 MB and is tracked below.

### Runtime image extras

- `apt: ffmpeg ca-certificates curl tini` — Debian Bookworm's ffmpeg is 5.1.x, which has every filter the renderer uses (`tpad`, `amix`, `concat`, `scale`, `crop`, `setsar`, `volume`).
- `tini` as PID 1 — `npm`/`node` don't forward `SIGTERM` cleanly; tini does, so `docker stop` is fast and graceful.
- `HEALTHCHECK` against `/api/config` — the one API route audited as pure (no disk, no binary, no external service), so it's a reliable liveness signal.
- Runs as the non-root `node` user shipped by the base image.

## What's in the image vs what's mounted

**Baked into the image** (immutable, rebuilt on `git pull`):

- `.next/` — compiled Next.js output
- `node_modules/` (production only)
- `public/`
- `next.config.ts`, `package.json`

**Bind-mounted at runtime** (state, must persist across restarts):

| Host path | Container path | Why mounted |
|---|---|---|
| `../v1Drive` | `/app/v1Drive` | Catalog (`notouch!/catalog.json` is writable), video library, music bed |
| `./runtime` | `/app/weatherV1-next/runtime` | `jobs.json`, `uploads/*.mp3`, `outputs/forecast_*.mp4`, poster + preview caches |

The container's `WORKDIR` is `/app/weatherV1-next` so that `process.cwd()` matches what `src/server/catalog/storage.ts:11-25` and `src/server/ffmpeg/renderer.ts:89` expect — both resolve `../v1Drive/...` (and `../app/music/...`) relative to cwd. Picking a different workdir would have required editing those files.

### The `app/music/` soft spot

`src/server/ffmpeg/renderer.ts:89` looks up the bg-music bed at `process.cwd()/../app/music/...`. That path comes from the Flask app's tree, not the Next port. Two options at deploy time:

1. **Bring `app/music/` along** — `rsync` the Flask app's music folder to `/opt/weatherV1/app/music/` on the VM. The renderer finds it; nothing else uses the path.
2. **Drop the bg-music** — if the music file is missing, the renderer logs a warning and renders without the music bed. Functional but worse output.

A future cleanup is to point this at `v1Drive/weather/music/` (which already exists in the canonical media tree) and drop the cross-project dependency.

## Environment contract

| Variable | Required | Read at | Notes |
|---|---|---|---|
| `OPENAI_API_KEY` | yes | OpenAI client (Whisper + GPT picker) | No fallback; transcribe + plan fail without it. |
| `GEMINI_API_KEY` | no | vision-describer when picking the segment backend | Falls back to GPT-4o-mini vision if unset. |
| `PORT` | no | Next.js (default 3000) | Container exposes 3000. |
| `HOSTNAME` | no | Next.js (default 0.0.0.0) | Must be `0.0.0.0` inside the container so it listens externally. |
| `FFMPEG_PATH` | no | `src/server/ffmpeg/binaries.ts:24` | Defaults to `which ffmpeg`. |
| `FFPROBE_PATH` | no | `src/server/ffmpeg/binaries.ts:28` | Defaults to `which ffprobe`. |
| `NODE_ENV` | no | Next.js | Forced to `production` in the runner stage. |

The image hardcodes production-safe defaults and lets the user override anything via `.env` (loaded by docker-compose's `env_file`).

## Production host shape

Typical single-box deploy: **2+ vCPU**, **4+ GB RAM**, **enough disk** for `v1Drive/` plus `runtime/` (jobs, uploads, outputs, caches), **ffmpeg + ffprobe** on the image or host, and ports **80/443** (or your reverse proxy) open to the container. The Dockerfile targets **multi-arch** (`linux/amd64` and `linux/arm64`); pick an ARM or x86 VM from any provider. No application code under `src/` is architecture-specific.

**Media growth:** keep large libraries on disk, or enable **Cloudflare R2** as an optional sidecar for catalog and object storage — see [`docs/R2_PULUMI_HANDOFF.md`](R2_PULUMI_HANDOFF.md) — without changing the ffmpeg-first design.

## Trade-offs and follow-ups

| Improvement | Status | Notes |
|---|---|---|
| Consume standalone tree in Docker runner | not done | `next.config.ts` already enables standalone (for Electron); switching the Docker runner to use it would shrink the image from ~250 MB to ~80 MB. |
| Move bg-music to `v1Drive/weather/music/` in `renderer.ts:89` | not done | Drops the cross-project filesystem dependency on the Flask `app/` tree. |
| GitHub Actions image publish | not done | Would push `weatherv1-next:arm64` to GHCR so the VM does `docker pull` instead of building. |
| Off-load media to object storage | optional | **Cloudflare R2** sidecar is implemented (`src/server/sync/r2/`). Use when you want a remote mirror, not as a ffmpeg remote-read path. |
| Replace in-process queue with Inngest / QStash | not needed | Single-instance + in-memory queue is the right shape for one VM. Only needed if multi-instance HA is ever required. |
| Pin ffmpeg to a static build | not needed | Debian's ffmpeg 5.1 has every filter the renderer uses. |

## Risks and mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| VM SKU unavailable in region | medium | Retry another region or provider; same `docker compose` layout. |
| Egress or disk overshoot | low | Monitor usage; rate-limit `/outputs`; prune old outputs; use R2 for cold catalog backup if needed. |
| Single-instance failure (no HA) | medium | Back up `runtime/` and `v1Drive/`; optional R2 catalog mirror (`docs/R2_PULUMI_HANDOFF.md`). |
| ffmpeg version regression on apt update | low | Rebuilding the image pulls the latest Debian ffmpeg. Pin the base image to a digest in `FROM` if it ever breaks. |
| Catalog corruption from concurrent writes | low | `proper-lockfile` on `catalog.json`; single-instance container means one writer at a time. |
