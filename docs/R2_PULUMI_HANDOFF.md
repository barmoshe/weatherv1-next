# R2 + Pulumi Asset Manager Handoff

## Current Goal

Replace the reverted Google Drive sync with Cloudflare R2-backed asset sync and Pulumi-managed Cloudflare infrastructure, while keeping WeatherV1 local-first for ffmpeg, previews, render inputs, uploads, and active catalog editing.

## Live Status

- Started from a clean worktree.
- Installed `@aws-sdk/client-s3` and `@aws-sdk/lib-storage`.
- Removed the Google Drive-backed catalog store and restored a local-only catalog store.
- Added R2 runtime config fields in `src/server/runtime/config.ts`.
- Extended catalog types with optional `remote` metadata and parsed-video `availability`.
- Changed catalog parsing so missing local files are still returned as `cloud_only` / `syncing` / `error` rows instead of being skipped.
- Added initial R2 sync modules under `src/server/sync/r2/`.
- Added initial R2 API routes under `src/app/api/sync/r2/*`.
- Hooked catalog import/update/delete into R2 sidecar sync.
- Hooked preview/poster routes to return a clear `409` when an asset is remote-only.
- Hooked render jobs to materialize remote source clips before ffmpeg and upload completed outputs to R2.
- Hooked transcription to upload voiceovers to R2 after a local transcription job is created.
- Added R2 sync status to desktop/internal health responses.
- Removed Google Drive from Electron config/main/preload, desktop bridge types, catalog tests, runtime desktop tests, and deleted Drive-specific source files/routes.
- Replaced the Settings modal Drive section with an R2 sync section for gateway URL, tenant ID, bucket name, app token, pull, push, and replace-remote conflict action.
- Added catalog UX pieces: R2 sync strip, skeleton catalog loading, debounced search with `/` focus, grid/list toggle, per-asset availability badges, and materialize/download actions for cloud-only assets.
- Added R2 poster sync for generated clip posters and every segment poster. Keys use `posters/clips/<videoId>.jpg` and `posters/segments/<segmentId>.jpg`.
- Added initial Pulumi project under `infra/cloudflare/`, including R2 bucket, lifecycle, optional CORS, Worker script, optional route, and README config instructions.
- Added Worker gateway source under `infra/cloudflare/worker/r2-gateway.js` with health, temporary credentials, and catalog GET/PUT endpoints.
- Verification: `npx tsc --noEmit` passes; `npm test` passes with 13 files / 72 tests; `npm run build` passes; `npm run standalone:prep` passes; final `npx tsc --noEmit` after route regeneration passes.
- Pulumi: `dev` stack initialized with account `f73ae3550198c571ad20f9fd06632200`; `pulumi up --non-interactive --yes` created R2 bucket `weatherv1-media`, R2 lifecycle rule, and Worker script `weatherv1-r2-gateway`.
- Pulumi project was changed to CommonJS (`infra/cloudflare/package.json`, `tsconfig.json`) because the installed Pulumi runtime could not load ESM TypeScript directly.
- Pulumi Worker deploy required `compatibilityDate: "2026-05-12"` because Cloudflare rejects future dates in UTC, and `mainModule: "worker.js"` so the ES module Worker is not parsed as classic service-worker syntax.
- Cloudflare account `workers.dev` subdomain is `barprojectsandbuilds`; Pulumi now manages `WorkersScriptSubdomain` and outputs the real gateway URL: `https://weatherv1-r2-gateway.barprojectsandbuilds.workers.dev`.
- Worker smoke tests pass: `/v1/health` returns bucket `weatherv1-media` / tenant `default`, and `/v1/r2/temporary-credentials` returns scoped temporary credentials for `tenants/default/`.
- Local `v1Drive/weather` upload to R2 completed. Source had 212 catalog videos totaling about 12.13 GiB; upload target was `tenants/default/videos/<videoId>/<filename>`, followed by `tenants/default/catalog/catalog.json` with `remote` metadata. Verified remote catalog has 212 videos and 212 `remote.key` values. Local catalog was updated from the verified remote catalog, with a backup saved next to it.

## 2026-05-13 update — Worker Basic Auth + login screen

- The Worker no longer accepts `Authorization: Bearer <appToken>`. It now enforces HTTP Basic Auth against `WEATHERV1_APP_USERNAME` + `WEATHERV1_APP_PASSWORD` (Worker secrets), with constant-time compare via `crypto.subtle.timingSafeEqual` and the length-mismatch-safe pattern. No `WWW-Authenticate` header is sent on 401 (machine-to-machine client, no browser popups wanted).
- Pulumi: replaced `appToken` secret with `appUsername` (plain config, default `"weatherv1"`) + `appPassword` (secret). Run `pulumi config set appUsername <user> && pulumi config set --secret appPassword <pw> && pulumi config rm appToken && pulumi up` to migrate an existing stack.
- Runtime: `r2.sessionToken` → `r2.appUsername` + `r2.appPassword`. Env vars `R2_SESSION_TOKEN` → `R2_APP_USERNAME` + `R2_APP_PASSWORD`. The R2 client sends `Authorization: Basic base64(user:pass)`.
- Electron settings: `keys.r2SessionToken` → `keys.r2AppPassword` (encrypted via `safeStorage`); the username lives non-secret under `r2.appUsername`. Legacy `r2SessionToken` is silently dropped on read.
- Desktop bridge: `DesktopSettingsUpdate.r2SessionToken` removed; replaced with `r2AppUsername` + `r2AppPassword`. `clearKeys: ["r2"]` clears the password only.
- UI: the sticky `studio-r2-token-card` is gone. `StorageOnboardingGate` now renders a real full-screen login (`.login-screen` / `.login-card`) with username, password (with show/hide toggle), and pre-fill from `r2.appUsername` (server-known) or `localStorage` cache. Settings modal's R2 section was rewritten the same way.

## Important Decisions

- R2 sync is a sidecar service beside local catalog CRUD. `readCatalog()` and `writeCatalog()` remain local and fast.
- Remote catalog writes are explicit through `/api/sync/r2/push` or follow-up sync hooks after local mutations.
- R2 credentials are requested from a Worker gateway as temporary scoped credentials. The app should not store permanent R2 keys.
- Remote-only catalog rows must appear in the UI. ffmpeg materializes remote media locally before preview/render.
- Deleting a catalog row does not silently delete local or R2 media unless the user explicitly asks for media deletion.

## Files Changed So Far

- `package.json`, `package-lock.json`
- `src/shared/types.ts`
- `src/server/runtime/config.ts`
- `src/server/catalog/stores.ts`
- `src/server/catalog/storage.ts`
- `src/server/catalog/parser.ts`
- `src/server/sync/r2/client.ts`
- `src/server/sync/r2/service.ts`
- `src/server/sync/r2/state.ts`
- `src/server/sync/r2/types.ts`
- `src/app/api/sync/r2/status/route.ts`
- `src/app/api/sync/r2/pull/route.ts`
- `src/app/api/sync/r2/push/route.ts`
- `src/app/api/sync/r2/materialize/route.ts`
- `src/app/api/sync/r2/retry/route.ts`
- `src/app/api/sync/r2/replace-remote/route.ts`
- `infra/cloudflare/index.ts`
- `infra/cloudflare/README.md`
- `infra/cloudflare/Pulumi.dev.yaml`

## Next Steps

1. Smoke-test Electron settings with gateway URL `https://weatherv1-r2-gateway.barprojectsandbuilds.workers.dev`, tenant `default`, bucket `weatherv1-media`, and the Pulumi `appToken` value.
2. Smoke-test catalog pull and materialize/download flows against R2 from the desktop UI.
3. Rotate the exposed R2 S3 credential pair after smoke testing because the secret access key was pasted into chat.
4. Update or archive `docs/ELECTRON_DESKTOP_PLAN.md`, which still describes the old Drive plan.

## Known Risks

- `tenantKey()` depends on runtime config, so avoid module-level constants that call it before env is loaded.
- `parseCatalog()` now returns remote-only rows; render and preview paths must materialize or gracefully reject cloud-only assets before touching ffmpeg.
- `docs/ELECTRON_DESKTOP_PLAN.md` still references the old Drive plan. It should be treated as historical until revised.
- Pulumi Worker binding enum strings and `WorkersScriptSubdomain` were accepted by Cloudflare during deploy.
- Segment poster sync currently runs after local imports and catalog segment edits when the source video exists locally. Remote-only assets must be materialized before poster generation.
