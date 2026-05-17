# R2 + Pulumi Reference

Current-state reference for the R2 sidecar. Operator commands and secrets inventory live in [`../infra/cloudflare/README.md`](../infra/cloudflare/README.md). Migration history: [`archive/R2_MIGRATION_HISTORY.md`](archive/R2_MIGRATION_HISTORY.md).

## Goal

Cloudflare R2-backed asset sync via Pulumi-managed infrastructure. WeatherV1 stays local-first for ffmpeg, previews, render inputs, uploads, and active catalog editing; R2 is a sidecar mirror.

## Object key layout

All uploads use `tenantKey(relative)` in [`src/server/sync/r2/client.ts`](../src/server/sync/r2/client.ts), which prefixes keys as `tenants/<tenantId>/` + `relative`. Examples:

- `catalog/catalog.json`
- `videos/<videoId>/<filename>`
- `posters/clips/<videoId>.jpg`
- `posters/segments/<segmentId>.jpg`
- `voiceovers/<jobId>/<basename>.mp3` (uploaded by the transcribe route via `uploadRuntimeFile`)
- `jobs/jobs.json` and `jobs/<jobId>/plan.json` (plan-bundle sidecar; written by the desktop app)
- `downloads/windows/{latest,<tag>}/WeatherV1-Setup.exe` (written by `desktop-publish-release.yml`; served by the Worker's public `/downloads/*` route)

Full object key for a segment poster with `tenantId=default`: `tenants/default/posters/segments/<segmentId>.jpg`.

**Forbidden prefix.** `outputs/` is intentionally not used. Rendered `forecast_<jobId>.mp4` files stay local — large, regenerable from the plan bundle, and previously uploaded under `tenants/<id>/outputs/<jobId>/forecast.mp4` (removed in 826a79b). [`uploadR2File`](../src/server/sync/r2/client.ts) throws on any key matching `(^|/)outputs/` as a defense-in-depth guard.

## Key decisions

- R2 sync is a sidecar beside local catalog CRUD. `readCatalog()` / `writeCatalog()` remain local and fast.
- Remote catalog writes are explicit (`/api/sync/r2/push`) or triggered by follow-up sync hooks after local mutations.
- R2 credentials are minted by a Worker gateway as short-lived scoped S3 creds (15 min). The app never stores permanent R2 keys.
- Remote-only catalog rows appear in the UI. ffmpeg materializes remote media locally before preview/render.
- Deleting a catalog row does not silently delete local or R2 media unless the user explicitly asks for media deletion.

## Known risks

- `tenantKey()` depends on runtime config — avoid module-level constants that call it before env is loaded.
- `parseCatalog()` returns remote-only rows; render and preview paths must materialize or gracefully reject cloud-only assets before touching ffmpeg.
- Segment poster sync runs after local imports and catalog segment edits when the source video exists locally — remote-only assets must be materialized before poster generation.
