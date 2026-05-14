# Local demo fixtures (optional)

Use these files to populate **segment posters**, **plan bundles**, and **jobs.json** on a dev machine. Nothing here runs automatically.

## Secrets

- Configure R2 via `.env.local` or Electron settings: gateway URL, tenant, bucket, **Worker Basic Auth** (`R2_APP_USERNAME` / `R2_APP_PASSWORD`).
- **Never** commit `.env.local`, Pulumi secrets, or passphrases. Use shell-only env for `PULUMI_CONFIG_PASSPHRASE` when running `pulumi`.

## Pull segment posters from R2

Requires posters already uploaded under `tenants/<tenant>/posters/segments/<segmentId>.jpg`.

Default segments (override by passing IDs as CLI args):

`IB001-s0`, `IB002-s0`, `IB003-s0`

```bash
./node_modules/.bin/vite-node --config vitest.config.ts scripts/pull-fixture-posters-from-r2.ts
```

Files are written to **`runtime/cache/segment_posters/<segmentId>.jpg`** (see `getRuntimePaths()`).

## Plan bundles + jobs

1. Copy sample plans into your runtime outputs directory (same root as the running app — typically **`runtime/outputs/`** next to `jobs.json`):

   - [`samples/forecast_fixture_demo_complete.plan.json`](samples/forecast_fixture_demo_complete.plan.json) → `runtime/outputs/forecast_fixture_demo_complete.plan.json`

   - [`samples/forecast_fixture_demo_processing.plan.json`](samples/forecast_fixture_demo_processing.plan.json) → `runtime/outputs/forecast_fixture_demo_processing.plan.json`

2. Merge [`samples/jobs.merge.json`](samples/jobs.merge.json) into **`runtime/jobs.json`** (object keyed by `job_id`). Preserve existing jobs if any — manually combine keys or use `jq`/`node` to merge maps.

3. Restart the app; open Studio with `?job=fixture_demo_complete` or `?job=fixture_demo_processing` when URL restoration is enabled.

## History / analytics

`useLocalHistory` reads **`localStorage`** (`weatherv1.history`), not `jobs.json`. Seed History tab separately from DevTools if needed.

## Catalog IDs

Sample timelines reference **`IB001-s0`**, **`IB002-s0`**, **`IB003-s0`**. Adjust IDs if your catalog differs.
