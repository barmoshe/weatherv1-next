---
name: weatherv1-plans
description: Manage and analyse WeatherV1 plan bundles — the scene planner, the catalog picker, the validator, and the per-job forecast_<jobId>.plan.json that accumulates transcript, scenes, and timeline. Use when debugging why the picker chose the wrong clip, editing the scene-planner or picker prompt, replanning one scene, or restoring a plan bundle from R2 after a fresh checkout.
---

# WeatherV1 Plans

Thin router for the planner-and-picker pipeline. Each job grows one
`runtime/outputs/forecast_<jobId>.plan.json` bundle over the
transcribe → plan → picker → render steps; this skill points you at the
files that produce and persist it.

## Load Order

1. `docs/DOCS_INDEX.md` — find the pipeline / scene-planner / picker row.
2. `src/server/jobs/plan-bundle.ts` — `updatePlanBundle(jobId, fields)`
   merges incrementally under an advisory lock; `hydratePlanBundleFromR2(
   jobId)` rehydrates from `tenants/<tenantId>/jobs/<jobId>/plan.json` on
   cold start; `PlanBundleSchema` is loose-passthrough so older bundles
   still load when new fields are added.
3. `src/server/pipeline/scene-planner.ts` — `DEFAULT_SCENE_PROMPT` (marked
   for ephemeral cache), `MIN_SCENE_DURATION`, `MAX_SCENES`, and the
   `Scene` shape (`idx`, `start_sec`, `end_sec`, `title_he`, `narration`,
   `keywords`, `mood`, `kind`, `heterogeneous`, `whisper_beat_indices`).
4. `src/server/pipeline/picker.ts` — `SCENE_AWARE_SYSTEM_PROMPT`,
   `PICKER_FALLBACK_PROMPT` (used on retry 2-3),
   `buildPickResponseSchema(catalogIds)` (Zod enum over catalog
   `segment_id`s — prevents model hallucination), and the `TimelinePick`
   shape (`scene_idx`, `segment_id`, `audio_start/end`,
   `video_start/end`, `picker_reason`).
5. `src/server/pipeline/validator.ts` — post-pick rule enforcement,
   segment-swap loop, and the `swaps: { attempted, succeeded }` report.

## Inspecting A Plan

- Open `runtime/outputs/forecast_<jobId>.plan.json`. Fields are added per
  step; an early-failed job may have only `transcript` + `transcript_segments`.
- Step usage lands on the job record (`usage_calls[*].step`), not the plan
  bundle. To pair a pick with its cost, join by `job_id` against
  `runtime/jobs.json` — see `weatherv1-jobs`.

## Debugging A Bad Pick

1. Look up the offending scene in the plan bundle's `scenes[]` — confirm
   the `narration`, `kind`, `keywords`, `mood`, and `heterogeneous` flag
   match expectations. A bad scene → bad picks downstream.
2. Look up the picked `timeline[*]` row and read `picker_reason`. If the
   reason is sound but the clip is still wrong, the catalog metadata is
   wrong (tags/concepts on that `segment_id`), not the picker.
3. Replan just that scene: `POST /api/replan_scene` with `{ job_id,
   scene_idx, … }`. Usage is appended as a `picker_replan` step.
4. If the planner itself is at fault, edit `DEFAULT_SCENE_PROMPT` and run
   a fresh end-to-end via `npm run dev`. Don't tune both planner and
   picker prompts in the same change — you lose attribution.

## Restoring / Backfilling

- Single job, cold start: `hydratePlanBundleFromR2(jobId)` runs lazily;
  forcing it is rarely necessary.
- Bulk: `scripts/backfill-r2-plan-bundles.ts` pulls all missing bundles
  from R2. Run this after a `runtime/` wipe.

## Default Checks

- `npx tsc --noEmit`
- `npm test` — the pipeline has substantial vitest coverage; run it after
  prompt or schema edits.
- For prompt edits, eyeball at least one fresh end-to-end job via
  `npm run dev`. Tests will not catch a regression in editorial quality.

## What This Skill Does Not Do

- Render the MP4 (ffmpeg pipeline lives under `src/server/ffmpeg/`).
- Edit provider clients (see `weatherv1-integrations`).
- Mirror plan bundles to R2 — `updatePlanBundle()` enqueues a mirror op
  automatically; failures show up in the R2 mirror queue (see
  `weatherv1-r2`).
