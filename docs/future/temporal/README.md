# Temporal.io Integration — Research

Status: **research only.** No code changes implied. Captured 2026-05-17 from a brainstorm session on branch `claude/temporal-integration-research-LDX8K`.

## What this set is

A folder of research notes exploring whether and how to integrate [Temporal.io](https://temporal.io) into WeatherV1's pipeline. The motivation that came up in conversation: **durability, observability, and scale** — the three things the current synchronous, in-process pipeline does not give us.

These docs are **not a commitment to ship.** They exist so a future session (human or agent) can pick the conversation up without re-deriving it.

## TL;DR

1. WeatherV1's pipeline is currently **synchronous and API-driven**: HTTP route handlers call Whisper → planner → picker → render in sequence, with a single in-memory render queue and a hand-rolled R2 mirror queue. The only durable async work today is R2 mirroring.
2. Temporal is a strong conceptual fit for **(a)** the R2 mirror queue (already shaped like Temporal) and **(b)** making renders crash-safe. It's an awkward fit for the desktop Electron runtime, which has to keep working offline.
3. The recommended architecture is **"one workflow definition, two clusters, workers near the data"**: same TypeScript workflow code runs against a cloud Temporal cluster for hosted web AND an embedded Temporal dev-server bundled inside Electron for desktop. Renders always run on the machine that owns the catalog.
4. The "cloud render pool" idea was dropped from the end state — the only justification was *symmetry*, and symmetry is achievable in code without moving ffmpeg off the user's machine.
5. **Suggested first milestone:** replace the existing `src/server/sync/r2/mirror-queue.ts` with a Temporal workflow. Web-only, real Temporal Cloud, minimal blast radius. See [`R2_MIRROR_PHASE1.md`](R2_MIRROR_PHASE1.md).
6. Two non-obvious taxes nobody warns you about, both documented here:
   - **Idempotency discipline** — every activity must be safe to retry, with deterministic dedup keys and a plan-bundle-backed cache. See [`IDEMPOTENCY.md`](IDEMPOTENCY.md).
   - **Versioning on desktop** — once workflows can outlive an app upgrade, you owe ongoing `patched()` discipline forever. See [`VERSIONING.md`](VERSIONING.md).

## File index

| Doc | What it covers |
| --- | --- |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | Two-cluster topology, task-queue capability routing, why "cloud render pool" was dropped. |
| [`PIPELINE_MAPPING.md`](PIPELINE_MAPPING.md) | How transcribe → plan → pick → render → r2-mirror map onto workflows + activities. Includes the parent-session workflow shape (Option Y). |
| [`EMBEDDED_ELECTRON.md`](EMBEDDED_ELECTRON.md) | Research on bundling the Temporal CLI dev-server inside the Electron app for offline-capable desktop. |
| [`IDEMPOTENCY.md`](IDEMPOTENCY.md) | Activity dedup convention: deterministic keys, plan-bundle as cache, prompt/catalog revisions, provider idempotency headers. |
| [`VERSIONING.md`](VERSIONING.md) | Worker Versioning vs `patched()` patching, why desktop is the hard case, the "session-lifetime" tradeoff. |
| [`UI_INTEGRATION.md`](UI_INTEGRATION.md) | Three UI shapes (hide Temporal, full async, hybrid) and what each costs. |
| [`R2_MIRROR_PHASE1.md`](R2_MIRROR_PHASE1.md) | Concrete proposal for the smallest first milestone — replacing the R2 mirror queue. |
| [`OPEN_QUESTIONS.md`](OPEN_QUESTIONS.md) | Decisions left unresolved at the end of the brainstorm, so next session knows what to pick up. |

## Reading order

If you have 10 minutes: this README + [`ARCHITECTURE.md`](ARCHITECTURE.md).
If you're picking up the work: read in the table order above.
If you're implementing Phase 1: read [`R2_MIRROR_PHASE1.md`](R2_MIRROR_PHASE1.md) and [`IDEMPOTENCY.md`](IDEMPOTENCY.md), skip the rest.
