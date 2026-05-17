---
name: weatherv1-jobs
description: Manage and analyse WeatherV1 jobs — lifecycle, status, the runtime/jobs.json store, per-job usage rollups, and cost estimates. Use when answering "how much did the last job cost", inspecting why a job is stuck in processing, triaging stale drafts, summarising spend across jobs, or hand-checking the usage_summary on a single job.
---

# WeatherV1 Jobs

Thin router for `src/server/jobs/**` and `runtime/jobs.json`. The job record
is the single observable for a run of the audio → mp4 pipeline; this skill
points you at the right file before you start grepping.

## Load Order

1. `docs/DOCS_INDEX.md` — find the row routing job-queue/store/worker work.
2. `src/server/jobs/schema.ts` — `JobStatusSchema`
   (`draft | queued | processing | completed | failed`) and the
   `JobRecord` shape persisted in `runtime/jobs.json`.
3. `src/server/jobs/store.ts` — the in-memory cache + on-disk JSON store.
   Functions: `getJob`, `getAllJobs`, `setJob`, `updateJob`, `deleteJob`,
   `upsertJob`. Note `crashRecoverySweep()` (flips orphan `processing` →
   `failed` on boot) and `DRAFT_WITHOUT_PLAN_MAX_AGE_MS` (24h stale-draft
   sweep). All mutations go through `updateJson()` with an advisory lock.
4. `src/server/jobs/usage-persist.ts` —
   `persistTranscriptionUsageEstimate(jobId, {...})`,
   `persistPlanUsage(jobId, scenePlanner, pickerUsages)`,
   `persistReplanPickerUsage(jobId, pickerUsages)`, and the
   `recomputeSummary(calls, transcription)` rollup.
5. `src/shared/usage.ts` — `LlmCallUsage`, `UsageCallRecord`,
   `JobUsageSummary` types. These are the field names you see on a job.

## Inspecting A Job

- Headline state: `runtime/jobs.json` keyed by `job_id`.
- Per-step detail (transcript, scenes, timeline, render path):
  `runtime/outputs/forecast_<jobId>.plan.json` — see `weatherv1-plans`.
- API: `GET /api/jobs` (lists, hydrates from R2 first via
  `pullJobsFromR2()`), `GET /api/jobs/[jobId]`, `GET /api/status/[jobId]`.

## Cost Analysis

- Per-job: `usage_summary.total_cost_usd_estimate`. Always check the
  `pricing_revision` stamp — if it matches the current
  `PRICING_REVISION` in `src/server/billing/usage-cost.ts`, trust it; if
  not, re-derive from `usage_calls` using that file's formulas.
- Across jobs: aggregate from `runtime/jobs.json` directly. Watch for jobs
  missing a `usage_summary` (older runs or failures before persist) — those
  contribute zero unless you compute from `usage_calls`.
- Steps observed in `usage_calls[*].step`: `transcription`,
  `scene_planner`, `picker_attempt_1`..`picker_attempt_3`, `picker_replan`.
- For a "last job" query, the latest entry sorted by `created_at` desc is
  the answer; `GET /api/jobs` already returns that order.

## Managing Job State

- Push local jobs to R2 explicitly: `POST /api/jobs/export-r2`.
- Inspect what's actually in R2: `scripts/check-r2-jobs-json.ts`.
- Archive old jobs from R2: `scripts/archive-r2-jobs.ts`.
- Do **not** hand-edit `runtime/jobs.json` to "unstick" a `processing` job.
  Restart the server — `crashRecoverySweep()` will flip it to `failed` so
  the user can retry through the UI.
- Do **not** delete plan bundles to force a re-run; use the replan/re-render
  routes (see `weatherv1-plans`).

## Default Checks

- `npx tsc --noEmit`
- `npm test`
- For changes to `store.ts` or `usage-persist.ts`, also run the related
  vitest file under `src/test/`.

## What This Skill Does Not Do

- Drive the worker loop or render — the worker drains the queue
  automatically on transition to `queued`.
- Edit per-step plan-bundle contents (see `weatherv1-plans`).
- Repair R2 mirror queue ops for `jobs.json` mirroring (see
  `weatherv1-r2`).
