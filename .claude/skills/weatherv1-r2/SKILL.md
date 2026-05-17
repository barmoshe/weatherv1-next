---
name: weatherv1-r2
description: Manage and analyse WeatherV1's R2 sidecar — sync state, the durable mirror queue, catalog conflicts, multipart uploads, and the Worker gateway. Use when the R2 mirror queue has dead ops, the catalog shows a conflict, an upload >90MB fails, /api/sync/r2/status reports trouble, or you need to materialize cloud-only clips before a render.
---

# WeatherV1 R2

Thin router for `src/server/sync/r2/**` and `runtime/r2-sync-state.json`.
The canonical docs are
[`docs/R2_PULUMI_HANDOFF.md`](../../../docs/R2_PULUMI_HANDOFF.md) and
[`infra/cloudflare/README.md`](../../../infra/cloudflare/README.md); for any
secret rotation, [`docs/RUNBOOK_WORKER_ROTATION.md`](../../../docs/RUNBOOK_WORKER_ROTATION.md)
is authoritative.

## Load Order

1. `docs/R2_PULUMI_HANDOFF.md` + `infra/cloudflare/README.md` — architecture
   and Pulumi setup.
2. `docs/RUNBOOK_WORKER_ROTATION.md` — before touching `R2_APP_USERNAME` /
   `R2_APP_PASSWORD`.
3. `src/server/sync/r2/client.ts` — HTTP-only client to the Worker gateway;
   `MAX_SINGLE_PUT_BYTES` (90 MB) and `MULTIPART_PART_BYTES` (8 MiB);
   `uploadR2File` rejects any key under `outputs/` as a defense-in-depth
   guard against shipping rendered MP4s to R2.
4. `src/server/sync/r2/state.ts` — `runtime/r2-sync-state.json` schema
   (`lastCatalogEtag`, `lastCatalogHash`, `conflict`, `objects`,
   `mirrors`, `lastMirrorError`). All mutations go through
   `patchR2SyncState(mutator)` under an advisory lock.
5. `src/server/sync/r2/mirror-queue.ts` — durable retry queue. Backoff
   schedule `[30s, 2m, 10m, 30m, 1h, 2h, 4h, 8h]` with full jitter; max 8
   attempts then `dead: true`. `kickMirrorQueue()` runs the background
   drainer; per-key coalescing means only the latest payload for a key is
   uploaded, not every intermediate write.
6. `src/server/sync/r2/service.ts` — `getR2SyncStatus()`,
   `pullCatalogFromR2()`, `pushCatalogToR2()` (etag-guarded),
   `replaceRemoteCatalog()`, `pullJobsFromR2()`, `materializeCatalogMedia()`,
   `R2CatalogConflictError`.

## Health Check

- `GET /api/sync/r2/status` — counts, conflict state, mirror-queue stats.
- For per-key detail, read `runtime/r2-sync-state.json` directly:
  `objects[<key>]` shows upload/download progress; `mirrors[]` lists
  pending ops with `attempts`, `nextAttemptAt`, `lastError`, `dead`.

## Catalog Conflict Resolution

When local hash ≠ remote etag, `conflict` is populated and pushes are
refused. Pick one:

- **Pull** (`POST /api/sync/r2/pull`) — merge remote → local. The default;
  use when someone else updated the catalog on another machine.
- **Push** (`POST /api/sync/r2/push`) — etag-guarded. Only succeeds if
  local was based on the current remote etag.
- **Replace remote** (`POST /api/sync/r2/replace-remote`) — dangerous,
  force remote ← local. Use only when the user is certain local wins.

## Dead Mirror Ops

When `mirrors[].dead === true` after 8 attempts:

1. Inspect `lastError` and the Worker logs.
2. Resurrect via `POST /api/sync/r2/retry` — resets `attempts` and
   `nextAttemptAt`. Don't raise the backoff cap or attempts limit unless
   you're sure the failure mode is transient.
3. If the same key keeps dying, the payload is likely the problem (size,
   schema, key prefix) — fix that, not the queue.

## Materializing Remote-Only Clips

- Before any render or preview that touches catalog rows with
  `availability="cloud_only"`: `POST /api/sync/r2/materialize` to
  download to local first. The ffmpeg pipeline cannot stream from R2.

## Object Key Layout

All keys live under `tenants/<R2_TENANT_ID>/`:

- `catalog/catalog.json`
- `videos/<videoId>/<filename>`
- `posters/clips/<videoId>.jpg`, `posters/segments/<segmentId>.jpg`
- `voiceovers/<jobId>/<basename>.mp3`
- `jobs/jobs.json`, `jobs/<jobId>/plan.json`
- **Never** `outputs/...` — `uploadR2File` throws on that prefix.

## Debugging

- `scripts/probe-r2-stream.ts` — streaming / multipart diagnostics.
- `scripts/check-r2-jobs-json.ts` — confirm `jobs.json` round-trips through
  R2 cleanly.

## Default Checks

- `npx tsc --noEmit`
- `npm test`
- After Worker or Pulumi changes, also `pulumi -C infra/cloudflare preview`
  and verify gateway URLs from `infra/cloudflare/README.md` are unchanged.

## What This Skill Does Not Do

- Touch the public `downloads/windows/...` release prefix — that's
  `weatherv1-release`.
- Edit credential storage on the desktop client (see
  `weatherv1-integrations`).
- Upload rendered job outputs. Renders stay local; the `uploadR2File`
  guard and the `CLAUDE.md` safety rule are the source of truth here.
