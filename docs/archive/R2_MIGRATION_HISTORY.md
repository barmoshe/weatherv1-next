# R2 Migration History

Archived changelog from the R2 + Pulumi migration. Current-state reference: [`../R2_PULUMI_HANDOFF.md`](../R2_PULUMI_HANDOFF.md). Pulumi operator runbook: [`../../infra/cloudflare/README.md`](../../infra/cloudflare/README.md).

## Migration Log

- Started from a clean worktree.
- Installed `@aws-sdk/client-s3` and `@aws-sdk/lib-storage`.
- Removed the Google Drive-backed catalog store and restored a local-only catalog store.
- Added R2 runtime config fields in `src/server/runtime/config.ts`.
- Extended catalog types with optional `remote` metadata and parsed-video `availability`.
- Changed catalog parsing so missing local files are returned as `cloud_only` / `syncing` / `error` rows instead of being skipped.
- Added R2 sync modules under `src/server/sync/r2/` and API routes under `src/app/api/sync/r2/*`.
- Hooked catalog import/update/delete into R2 sidecar sync.
- Hooked preview/poster routes to return `409` for remote-only assets.
- Hooked render jobs to materialize remote source clips before ffmpeg. (Original change also uploaded `forecast.mp4` outputs to R2; removed in 826a79b — renders stay local.)
- Hooked transcription to upload voiceovers to R2 after a local transcription job is created.
- Added R2 sync status to desktop/internal health responses.
- Removed Google Drive from Electron config/main/preload, desktop bridge types, catalog tests, runtime desktop tests, and deleted Drive-specific source files/routes.
- Replaced the Settings Drive section with R2 sync (gateway URL, tenant ID, bucket, app token, pull, push, replace-remote).
- Added catalog UX: R2 sync strip, skeleton loading, debounced search with `/` focus, grid/list toggle, per-asset availability badges, materialize/download for cloud-only.
- Added R2 poster sync for clip and segment posters under `posters/{clips,segments}/<id>.jpg`.
- Added Pulumi project under `infra/cloudflare/` (R2 bucket, lifecycle, optional CORS, Worker script, optional route).
- Added Worker gateway source `infra/cloudflare/worker/r2-gateway.js` (health, temporary credentials, catalog GET/PUT).
- Pulumi: `dev` stack initialized; `pulumi up` created R2 bucket `weatherv1-media`, lifecycle rule, and Worker `weatherv1-r2-gateway`.
- Pulumi project changed to CommonJS because the installed Pulumi runtime couldn't load ESM TypeScript directly.
- Pulumi Worker deploy required `compatibilityDate: "2026-05-12"` and `mainModule: "worker.js"`.
- Cloudflare `workers.dev` subdomain `barprojectsandbuilds`; Pulumi manages `WorkersScriptSubdomain` and outputs the gateway URL.
- Worker smoke: `/v1/health` returns bucket + tenant; `/v1/r2/temporary-credentials` returns scoped creds.
- Local `v1Drive/weather` upload: 212 catalog videos (~12.13 GiB) under `tenants/default/videos/<videoId>/<filename>`; catalog pushed; verified remote 212 videos.

## 2026-05-13 — Tagging + R2 poster mirror

- Empty segments tagged + described: 193 (1 skipped as uninformative). Local-only initially — `pushCatalogToR2()` and 194 segment posters deferred.
- Later same day: `scripts/sync-segment-posters.ts --skip-clips` uploaded all 406 segment posters (193 new, 213 already present). Catalog pushed with `replaceRemoteCatalog()` — etag `36ff8fc768c910974647b7c3075f63e1`. Remote verified at 212 videos / 406 segments / 405 tagged / 1 empty (`IB019-s33`).
- The standard `pushCatalogToR2` tripped its conflict guard (fresh CLI session had no `lastCatalogEtag` cached) — `replaceRemote: true` was the safe bypass.
- Repair pass: long-clip / wrong-span fix for `IB012` (`scripts/repair-long-single-segments.ts`). Catalog 406→408; +2 segment posters; `replaceRemoteCatalog()` etag `c4ae832aa4a04528e33873a746b44eaa`.
- Tagged `IB019-s33` (park sign — factual nature/urban/day tags). **408/408** segments tagged.
- `runtime/r2-sync-state.json` is gitignored as local machine state.

## 2026-05-13 — Worker Basic Auth + login screen

- Worker no longer accepts `Authorization: Bearer <appToken>`. Enforces HTTP Basic Auth against `WEATHERV1_APP_USERNAME` + `WEATHERV1_APP_PASSWORD` (Worker secrets) with `crypto.subtle.timingSafeEqual` + length-mismatch-safe compare. No `WWW-Authenticate` header on 401 (machine-to-machine).
- Pulumi: replaced `appToken` secret with `appUsername` (plain config, default `"weatherv1"`) + `appPassword` (secret). Migrate: `pulumi config set appUsername <user> && pulumi config set --secret appPassword <pw> && pulumi config rm appToken && pulumi up`.
- Runtime: `r2.sessionToken` → `r2.appUsername` + `r2.appPassword`. Env: `R2_SESSION_TOKEN` → `R2_APP_USERNAME` + `R2_APP_PASSWORD`. Client sends `Authorization: Basic base64(user:pass)`.
- Electron settings: `keys.r2SessionToken` → `keys.r2AppPassword` (encrypted via `safeStorage`); username non-secret under `r2.appUsername`. Legacy `r2SessionToken` silently dropped.
- Desktop bridge: `DesktopSettingsUpdate.r2SessionToken` removed → `r2AppUsername` + `r2AppPassword`. `clearKeys: ["r2"]` clears password only.
- UI: sticky `studio-r2-token-card` removed. `StorageOnboardingGate` renders a real full-screen login (`.login-screen` / `.login-card`) with username, password + show/hide toggle, pre-fill from `r2.appUsername` or `localStorage` cache. Settings modal R2 section rewritten the same way.

## Files Touched (snapshot)

- `package.json`, `package-lock.json`
- `src/shared/types.ts`
- `src/server/runtime/config.ts`
- `src/server/catalog/{stores,storage,parser}.ts`
- `src/server/sync/r2/{client,service,state,types}.ts`
- `src/app/api/sync/r2/{status,pull,push,materialize,retry,replace-remote}/route.ts`
- `infra/cloudflare/{index.ts,README.md,Pulumi.dev.yaml}`
