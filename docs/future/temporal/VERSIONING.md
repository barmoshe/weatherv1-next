# Versioning and Migration — The Hard Part

## TL;DR

Temporal workflow code is **deterministic by contract**: replaying the same workflow history with the same code must produce the same decisions. Change the code, and old workflows replaying against the new code crash with `NonDeterminismError`. Temporal's two official answers are **Worker Versioning** (route old workflows to old workers) and **patching with `patched()`** (branch in-code per change).

For WeatherV1, the **web** runtime has the easy version of this problem (one server, blue-green deploys, Worker Versioning works). The **desktop** runtime has the hard version: users upgrade their app whenever they feel like it, and if workflows can live across upgrades, every code change risks breaking in-flight workflows on someone's machine.

This document captures the tradeoffs so the decision isn't taken implicitly later.

## Sources

- [Worker Versioning — Temporal Platform Documentation](https://docs.temporal.io/production-deployment/worker-deployments/worker-versioning)
- [Versioning — TypeScript SDK](https://docs.temporal.io/develop/typescript/versioning)
- [Safe deployments with Temporal Worker Versioning on Kubernetes](https://temporal.io/blog/safe-deployments-with-temporal-worker-versioning-on-kubernetes)
- [Announcing Worker Versioning Public Preview](https://temporal.io/blog/announcing-worker-versioning-public-preview-pin-workflows-to-a-single-code)

## The two strategies

### Worker Versioning (recommended where it works)

- Each worker deployment is tagged with a version.
- The Temporal Server routes each workflow's tasks to a worker matching the version the workflow started on.
- v1 workflows finish on v1 workers; new workflows start on v2 workers.
- No `if (patched(...))` branches in code — workflow code is just *the workflow code*, and version pinning happens at the infrastructure layer.
- Designed for blue-green / canary deployments where you can run multiple worker versions in parallel.

**This is the right answer for the web runtime.** The hosted web product can run worker v1 and worker v2 side by side; old workflows drain on v1, new ones go to v2.

### Patching (`patched()`)

- Every workflow code change that affects decision history gets wrapped in `if (patched("v2-fix-foo")) { ... new ... } else { ... old ... }`.
- Old workflows take the `else` branch (because the patch wasn't there when they started); new ones take the `if`.
- Once all v1 workflows have completed, you switch to `deprecatePatch("v2-fix-foo")`, and eventually delete the old branch.
- Doesn't require running multiple worker versions — one worker process can serve both.

**This is the only option for the embedded desktop runtime.** You can't run "two worker versions side by side" inside a single Electron process across an app upgrade.

## The desktop problem in detail

### What "an upgrade" looks like on desktop

1. User has WeatherV1 v2 running. A `JobSessionWorkflow` is in progress (e.g. user transcribed audio yesterday, is editing scenes today, hasn't rendered yet).
2. User installs v3, which we shipped with a tweak to how `runPickerOnce` requests scenes from the LLM (say, we added a new field to the prompt).
3. App restarts. The embedded Temporal worker comes up running v3 workflow code.
4. The in-flight workflow replays its history. Eventually it hits the new code path. Non-determinism error. Workflow fails.

### Scenarios that produce this

- Adding a new activity call
- Reordering existing activity calls
- Changing the arguments to an activity (the activity is still called, but the call shape differs)
- Adding a new branch (`if`) anywhere in the workflow
- Changing the workflow's signal handlers (new signals, removed signals)

### Scenarios that do NOT produce this

- Changing an activity's *implementation* (the workflow doesn't see the body, only the call site)
- Adding a new workflow definition (existing workflows of other types are unaffected)
- Changing UI / API / non-workflow code

### Options for desktop (in escalating cost)

#### Option D1 — "Workflows must complete within a single app session"

Declare that all workflows are short-lived. On app shutdown, cancel everything in-flight. On next launch, start fresh.

- **Cost**: user-hostile if a workflow takes >a few minutes. A render of a 10-minute forecast might run several minutes; cancelling it because the user closed the lid is bad UX.
- **Verdict**: viable only if we adopt Option X (per-action workflows) from [`PIPELINE_MAPPING.md`](PIPELINE_MAPPING.md) AND keep workflows short. Incompatible with the Option Y long-lived session workflow.

#### Option D2 — "Cancel on user-initiated upgrade, resume on crash"

Distinguish graceful shutdown (user triggered upgrade → cancel in-flight) from crash (resume on restart). Crash recovery is what Temporal does natively; the cancel-on-upgrade path is something we explicitly trigger before the upgrade installer runs.

- **Cost**: still loses the user's in-flight work on upgrade. Not as bad as D1 (crashes are recoverable, scheduled upgrades give the user a chance to wait), but the work loss is the same.
- **Verdict**: usable if we make upgrades opt-in and notify the user clearly when they have in-flight work.

#### Option D3 — Full `patched()` discipline

Every workflow change gets a patch. Maintain old branches until no v_prev workflows can be in flight on any user's machine.

- **Cost**: ongoing tax forever. Code gets uglier over time. "When can I delete patch X" requires knowing the oldest version of the app anyone is still running, which we don't have telemetry for.
- **Verdict**: necessary if we adopt Option Y (long-lived session workflows). The cost is real but bounded — most patches can be retired after one app release cycle if we wait long enough.

#### Option D4 — Worker Versioning, bundled

Ship multiple versions of the workflow code inside one Electron app. Let the embedded Temporal route old workflows to the old code, new ones to the new code.

- **Cost**: bundle size grows linearly with the number of supported versions; tooling to "deprecate workflow version N" is something we'd have to build; significant ongoing complexity.
- **Verdict**: probably too much for a single-user desktop app. Reserved as a last resort.

### Recommended desktop strategy

- **Phase 1–2 (no desktop Temporal yet):** N/A.
- **Phase 3 (embedded Temporal arrives), if Option X workflows:** D2. Workflows are short, occasional cancellation is tolerable.
- **Phase 3, if Option Y workflows:** D3. Accept the patched()-tax. Document the convention; require every workflow PR to declare whether it needs a patch.

## The web problem (briefly)

Far less interesting:

- We control the deployment.
- We can run two worker versions side-by-side during a deploy.
- Worker Versioning solves this cleanly.
- The only ongoing cost is remembering to bump the worker version on each deploy, which can be automated in the CI workflow that already exists (`.github/workflows/desktop-publish-release.yml` model).

## What changes about WeatherV1's release process

If Phase 3 ships:

1. Every release that touches `src/server/temporal/workflows/**` must declare in the release notes which workflows changed and whether the change needs a patch.
2. CI gains a "non-determinism check" — replay a representative set of historic workflow histories against the new code and fail the build if any throw `NonDeterminismError`. The Temporal SDK supports this offline replay (`Worker.runReplayHistory`).
3. The Electron auto-update flow (or manual update check from [`docs/future/MANUAL_UPDATE_CHECK.md`](../MANUAL_UPDATE_CHECK.md)) needs to handle the "you have N in-flight jobs, do you want to wait or cancel them?" prompt.

## Open question for the next session

Whether to commit to Option X or Option Y in [`PIPELINE_MAPPING.md`](PIPELINE_MAPPING.md). The answer fully determines which desktop versioning strategy we adopt. The brainstorm tentatively favored Option Y for its Temporal-idiomatic feel, then backed off when the versioning cost became clear. Marked unresolved in [`OPEN_QUESTIONS.md`](OPEN_QUESTIONS.md).
