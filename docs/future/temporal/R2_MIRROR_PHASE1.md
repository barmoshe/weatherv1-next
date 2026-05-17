# Phase 1 — Replace R2 Mirror Queue with a Temporal Workflow

## Why this is Phase 1

The R2 mirror queue in `src/server/sync/r2/mirror-queue.ts` is **already shaped like a Temporal workflow.** It has:

- Durable per-op state (`runtime/r2-sync-state.json`)
- An exponential backoff schedule (`[30s, 2m, 10m, 30m, 1h, 2h, 4h, 8h]`)
- A dead-letter concept
- A coalescing-by-key feature (multiple writes to the same R2 key collapse into one upload of the latest content)
- A drain loop

Replacing it with a real workflow is **the smallest possible Temporal change** that:

1. Touches no user-facing code.
2. Replaces a hand-rolled durable mechanism with a managed one.
3. Gives us the Temporal Web UI for inspecting stuck mirror ops — a real debugging win today (anyone who's stared at `runtime/r2-sync-state.json` knows).
4. De-risks the whole integration by proving the worker/cluster wiring works before we commit to bigger refactors.

## Scope

- **Web runtime only.** Desktop keeps the existing mirror queue for now. The integration is one-sided — desktop doesn't see Temporal yet. Means the embedded-in-Electron research can stay research.
- **Cluster:** Temporal Cloud, free tier. Cheapest, lowest-ops, fastest to set up.
- **Code surface:** new `src/server/temporal/` directory with the workflow, the activity, the worker bootstrap. Existing `src/server/sync/r2/client.ts` is unchanged — the activity wraps it.

## Workflow design

### The mirror workflow

One long-running workflow per cluster, started at server boot:

```
R2MirrorWorkflow
  state:
    pending: Map<r2Key, { contentRef, enqueuedAt, attempts, lastError? }>
    dead: Map<r2Key, { contentRef, lastError, deadSince }>

  signals:
    enqueueR2Op(r2Key, contentRef)         // add or overwrite (coalesce)
    forceDrain()                            // skip backoff timer
    reviveDeadOp(r2Key)                     // pull from dead → pending
    removeDeadOp(r2Key)                     // explicit dismissal

  queries:
    getPending() → list
    getDead() → list
    getStatus() → { pendingCount, deadCount, oldestEnqueuedAt }

  loop:
    1. await condition: pending is non-empty
    2. compute next-due timestamp across all pending
    3. await timer until next-due (interruptible by enqueueR2Op signal)
    4. for each due op:
         - schedule mirrorR2 activity with retry policy
         - on success: remove from pending
         - on failure: increment attempts, recompute next-due,
                       OR move to dead if attempts == MAX
    5. periodically continueAsNew to keep history bounded
```

### The mirror activity

```
mirrorR2(r2Key, contentRef) → void
  - read content from disk (or wherever contentRef points)
  - PUT to R2 via existing client (uploadR2Buffer / putR2Text)
  - returns when R2 acks
  - throws on R2 error → Temporal handles retry per the workflow's retry policy
```

The activity is intrinsically idempotent — R2 PUTs to the same key with the same content are no-ops on the second call.

### How coalescing works

The current queue's coalescing — "5 writes to `catalog.json` in 10 seconds = 1 upload" — is preserved by **the workflow's pending Map being keyed by `r2Key`.** When `enqueueR2Op('catalog.json', contentRef_v5)` arrives via signal, it overwrites whatever was previously pending for `'catalog.json'`. Only the most recent `contentRef` ever gets uploaded.

This is option 2 from the original brainstorm's three coalescing models — pragmatic and simple, single workflow to watch in the UI.

### Choosing `contentRef`

Two options:

- **Inline the content** (small payloads only). Workflow history grows, but coalescing means duplicates collapse.
- **Pointer to a disk file** (current approach — `runtime/r2-sync-state.json` references payload files). Smaller history; activity reads from disk at upload time. Slight risk that disk content changes between enqueue and upload (which is actually the *point* — we want the latest content).

Recommend: pointer to disk file, mirroring today's behavior. Reuse the existing `runtime/r2-sync/` payload layout to keep the migration boring.

## Migration plan

1. **Spike: bare workflow + activity** running against `temporal server start-dev` locally. One test case — enqueue 10 ops to the same key, observe 1 upload. (1 day)
2. **Wire to real R2** — point at the dev R2 bucket. Verify uploads succeed and the Temporal UI shows clean history. (1 day)
3. **Shadow mode** — in dev, run BOTH the existing mirror queue AND the Temporal workflow side-by-side. Enqueue every op into both. Compare outcomes. Catches semantic differences. (3 days)
4. **Cut over in web prod** — feature flag controls which queue handles ops. Default off. Flip on for one tenant, observe a day, flip on for all. (2 days)
5. **Delete the old code** — once Temporal-backed queue has been the sole queue for two weeks with no incidents, delete `src/server/sync/r2/mirror-queue.ts` and `runtime/r2-sync-state.json` handling. (1 day)

Total: ~8 working days, plus the soak period.

## Risk register

| Risk | Mitigation |
| --- | --- |
| Temporal Cloud auth flakiness on the worker side blocks all R2 mirroring | Keep the existing queue behind the feature flag for instant rollback. Worker is decoupled from API routes — restart doesn't impact request serving. |
| Workflow history grows unbounded | Periodic `continueAsNew` once history > 10k events. Tested in step 3 with sustained load. |
| Dead-letter ops harder to inspect than today (today: `cat runtime/r2-sync-state.json`) | Temporal Web UI shows the workflow's queryable state. Also expose `GET /api/sync/r2/status` reading from a workflow query. |
| Free tier action ceiling (10K/month) | Sanity-check: a typical month's R2 mirror traffic in current logs. Each op is ~2 actions (signal in, activity exec). Free tier covers ~5K ops/month. Above that, the paid tier is $25/M actions — still negligible. |
| Adds an external cluster dependency to the web product | Pin a fallback: if Temporal client can't reach the cluster, server boot logs loud, **and** falls back to in-process queue. Defense in depth. |

## What this Phase 1 does NOT change

- Desktop runtime — fully untouched.
- HTTP API surface — unchanged.
- Studio UI — unchanged.
- Plan bundle / job lifecycle — unchanged.
- `outputs/` R2 ban — still enforced.
- Existing R2 status / retry endpoints (`/api/sync/r2/status`, `/api/sync/r2/retry`) — same behavior, different backend.

## Verification

- [ ] Type check passes (`npx tsc --noEmit`).
- [ ] Existing R2 sync unit tests still pass; new tests cover the workflow.
- [ ] In dev: enqueue a 50-write burst to one key, observe exactly 1 upload.
- [ ] In dev: kill the worker mid-upload, restart, observe the upload retries cleanly.
- [ ] In dev: trigger 8 consecutive failures (e.g. point at a broken R2 URL), observe dead-letter entry.
- [ ] Web staging soak for ≥7 days at production-like volume before prod cutover.

## Files (anticipated)

```
src/server/temporal/
├── client.ts                       # Singleton Temporal client (worker side)
├── worker.ts                       # Worker bootstrap, task queue registration
├── workflows/
│   └── r2-mirror.ts                # R2MirrorWorkflow
└── activities/
    └── mirror-r2.ts                # mirrorR2 activity wrapping existing R2 client

src/server/sync/r2/
└── mirror-queue.ts                 # KEPT during shadow mode, DELETED after cutover

.env.example
├── + TEMPORAL_ADDRESS              # e.g. <namespace>.tmprl.cloud:7233
├── + TEMPORAL_NAMESPACE
└── + TEMPORAL_API_KEY (or mTLS cert paths)
```

## Doneness

Phase 1 is done when:

- All R2 mirror traffic in production flows through the Temporal workflow for ≥2 weeks with no incidents.
- The old mirror queue code is deleted.
- A new doc moves from `docs/future/temporal/R2_MIRROR_PHASE1.md` into `docs/archive/` per the CLAUDE.md convention.
- The architecture overview gets a sentence: "Web R2 mirror runs as a Temporal workflow; see `archive/R2_MIRROR_PHASE1.md`."
