# Architecture — Temporal Integration

## Goal

Define the target topology for a Temporal-backed WeatherV1, given the two hard constraints surfaced in the brainstorm:

1. **The desktop runtime must work offline.** No "phone home to a cluster" model for Electron users on a plane.
2. **Renders need source clips on local disk.** Catalog is local-first; remote renders would have to pull the catalog from R2 first.

## Current state (for contrast)

- Single Node process per runtime (Next.js dev server, or the Electron-supervised Next standalone child).
- Pipeline steps are driven **synchronously by HTTP route handlers** — no background worker, no real queue.
- Render is the one exception: pushed onto a `string[]` array in `src/server/jobs/worker.ts:24`, drained by a `setImmediate` loop in the same process.
- R2 mirror is the only durable async work — JSON-persisted ops with hand-rolled exponential backoff in `src/server/sync/r2/mirror-queue.ts`.
- On crash: `crashRecoverySweep()` on next boot re-enqueues any job left in `queued` status. Anything `processing` is lost.

## Target topology

> **One workflow definition. Two clusters. Workers run where the data is.**

### The two clusters

| Cluster | Where it runs | Who connects to it |
| --- | --- | --- |
| **Cloud cluster** (Temporal Cloud free tier, or self-hosted) | Anywhere reachable from the hosted web server | The web server's worker process; potentially future multi-tenant workers |
| **Embedded cluster** (Temporal CLI's `start-dev` mode, SQLite-backed) | Bundled inside the Electron app, runs on `127.0.0.1` at app startup | The Next standalone child running inside Electron |

The two clusters are **completely independent** — no replication, no federation. They share only the **workflow code** (one set of `.ts` files in `src/server/temporal/workflows/`) and the activity implementations.

This is the simplest model that satisfies both constraints. Trying to make desktop talk to a remote cluster (or sync local→remote workflows) gets complicated fast and buys nothing the user actually asked for.

### Why not "cloud render pool"

The brainstorm originally targeted a cloud render pool as the end state. It was dropped because:

- The only stated motivation was **symmetry** — making everything flow through the same orchestrator.
- Symmetry is achievable in code (one workflow definition) without symmetry in topology.
- Desktop must render locally regardless (offline requirement + catalog locality).
- Building a second render path that's never the critical one for desktop users adds cost with no proportional benefit.
- The `outputs/` ban in CLAUDE.md (`uploadR2File` throws on any `outputs/` key) was put in place deliberately; lifting it has cost/privacy implications that aren't justified by "symmetry alone."

**Reserved as a future option.** If a hosted multi-tenant web product ever ships, cloud render becomes load-bearing (browser users can't render on their own machines). The workflow definitions should be written such that a `render` activity *could* be served by a cloud worker — just don't build the cloud worker pool until there's a real reason.

## Task-queue capability routing

Temporal's task-queue mechanism is how we keep "same workflow, different worker placement" honest. Workers register on capability-tagged task queues; the workflow picks the queue per activity.

| Task queue | Who serves it (today) | Who could serve it (later) |
| --- | --- | --- |
| `weatherv1-llm` | Web server worker; desktop embedded worker | Cloud worker pool, edge workers |
| `weatherv1-render` | Only the worker that owns the catalog (desktop → embedded worker; web → server-local worker) | Cloud render pool when the hosted multi-tenant product exists |
| `weatherv1-r2-mirror` | Web server worker (Phase 1 ships this only); later, embedded worker on desktop too | — |
| `weatherv1-session` | Same as `render` — affinity to the catalog owner | — |

The key property: a `render` activity will never accidentally run on a worker that doesn't have catalog access, because no such worker is registered on `weatherv1-render`.

## Runtime split

### Hosted web (Next.js standalone)

- Long-lived Node process that already hosts the API.
- Spawns (or co-deploys) a Temporal worker process that registers on all four task queues above.
- Connects to the cloud Temporal cluster.
- Workflows triggered by HTTP routes via `client.workflow.start(...)`; UI subscribes to progress.

### Desktop (Electron)

- Main process spawns the bundled `temporal` binary at app start with `--db-filename=<userData>/temporal.db` on a chosen loopback port.
- The Next standalone child runs an embedded worker on `127.0.0.1:<port>`.
- Same workflow code, just running against the embedded cluster.
- Temporal Web UI on `<port+1>` becomes a free "what is my app doing" debug surface for desktop users.
- See [`EMBEDDED_ELECTRON.md`](EMBEDDED_ELECTRON.md) for the bundling research.

## What stays the same in the codebase

- The plan bundle (`runtime/outputs/forecast_<jobId>.plan.json`) remains the durable source of truth for job content.
- The catalog and R2 sidecar contract is unchanged.
- The HTTP API surface mostly stays (see [`UI_INTEGRATION.md`](UI_INTEGRATION.md) for which routes change shape).
- Local-first invariants in CLAUDE.md remain intact, including the `outputs/` R2 ban.

## What changes in the codebase

- New directory `src/server/temporal/` houses workflows + activities.
- `src/server/jobs/worker.ts` (the in-process render queue) gets replaced by a Temporal worker registration.
- `src/server/sync/r2/mirror-queue.ts` gets replaced by an `R2MirrorWorkflow` (Phase 1).
- `runtime/jobs.json` becomes a denormalized view of workflow state, not the source of truth. Reads go to Temporal for live data; jobs.json is rebuilt on workflow events for fast list views.

## Non-goals (explicit, so they don't get relitigated)

- **Not** building a cloud render pool in Phase 1–3.
- **Not** sharing workflow state between the cloud cluster and the embedded desktop cluster.
- **Not** lifting the R2 `outputs/` ban as part of this work.
- **Not** rewriting the plan bundle schema as part of this work (additive only — see [`IDEMPOTENCY.md`](IDEMPOTENCY.md) for the cache section addition).
- **Not** moving to a single `/api/jobs` UI entry point in Phase 1 — see [`UI_INTEGRATION.md`](UI_INTEGRATION.md) for the hybrid path.
