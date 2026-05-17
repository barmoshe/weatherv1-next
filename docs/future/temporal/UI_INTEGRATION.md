# UI Integration — How the Studio Talks to Workflows

## Context

Today the WeatherV1 studio drives the pipeline by calling HTTP routes in sequence: `POST /api/transcribe`, then `POST /api/plan`, then `POST /api/render` followed by polling `/api/jobs/:id`. The UI essentially holds the orchestration state.

Once Temporal owns orchestration, this changes. How much it changes depends on which UI shape we pick.

## Three shapes

### U1 — "Hide Temporal entirely" (minimal UI work)

- Existing HTTP routes stay. `POST /api/transcribe` still blocks until transcription completes.
- Under the hood each route is just `await client.workflow.execute(WorkflowFn, args)`.
- UI doesn't know Temporal exists.

**Wins:** zero UI refactor; lowest risk; easy to roll back by `await`-ing a non-Temporal implementation instead.

**Loses:** the long-HTTP-hold problem. A 60-second picker call has the browser waiting on an open connection — fine on the desktop loopback, fragile across real networks. Throws away one of Temporal's biggest wins (resumable + observable progress).

**When to pick:** Phase 1 (R2 mirror), which doesn't go through these routes at all and is a perfect fit. Or as a fallback if the more ambitious shapes prove too painful.

### U2 — "Full Temporal-idiomatic" (biggest refactor)

- One new route: `POST /api/jobs` returns `{jobId, workflowId}` immediately. UI never POSTs anything else.
- UI subscribes to `GET /api/jobs/:id/events` as an SSE/WebSocket stream of workflow history events translated into UI-relevant updates: `"transcribing"`, `"planning"`, `"scene 3/8 rendering"`, etc.
- User actions (replan, edit, render) become signals: `POST /api/jobs/:id/signals/replanScene` etc.
- User can close the tab, come back tomorrow, resubscribe, see the current state.

**Wins:** the UX matches what users actually want — "kick off a thing, see progress, come back when done." Truly resumable across page reloads, restarts, even devices (if web ever goes multi-device).

**Loses:** big refactor of the studio. Every existing component that imperatively walks the pipeline becomes a subscriber to a stream. State management gets more complex. Hard to roll back.

**When to pick:** if/when Option Y (long-lived `JobSessionWorkflow`) is adopted. Option Y essentially requires this UI shape because the workflow lives longer than any single HTTP call.

### U3 — "Hybrid" (recommended path)

- Short steps stay synchronous: `POST /api/transcribe`, `POST /api/plan` still block. Their internal implementation is `await client.workflow.execute(...)`, but the UI sees the same behavior as today.
- The long step changes: `POST /api/render` returns immediately with `{jobId, workflowId}`. UI subscribes to `/api/jobs/:id/render/events` via SSE for progress updates.
- R2 mirror is invisible to the UI — its workflow runs in the background, optionally surfaced in a `GET /api/sync/r2/status` endpoint (which already exists).

**Wins:** each step is independently shippable. Transcribe/plan refactor can be deferred indefinitely; only render gets the new event-stream UX in Phase 2. The studio code only changes in one place (the render flow). Easy to ship incrementally.

**Loses:** two execution patterns coexist in the API. Slightly inconsistent.

**When to pick:** Phase 2 (crash-safe renders) if we stick with Option X workflows. Brainstorm consensus.

## Event-stream contract (for U2/U3 render flow)

The studio doesn't want to see raw Temporal history events — it wants UI-relevant deltas. The server-side translator collapses Temporal's event stream into a smaller alphabet:

| UI event | Triggered by |
| --- | --- |
| `transcribe.started` | `whisperTranscribe` activity started |
| `transcribe.completed` | activity completed |
| `plan.started` | `runScenePlanner` activity started |
| `plan.scene` | partial — emitted when a scene block lands (if streaming) |
| `plan.completed` | `runScenePlanner` completed |
| `pick.attempt` | `runPickerOnce` started, with attempt number |
| `pick.completed` | succeeded |
| `render.frame` | from ffmpeg progress parsing (already exists in current code) |
| `render.completed` | `runFfmpeg` completed |
| `error` | any activity failure that exhausted retries |
| `job.completed` | workflow completed |
| `job.cancelled` | workflow cancelled |

Transport: SSE is simpler than WebSocket and sufficient (server → client only). The existing Next.js API route handlers support SSE responses; the desktop runtime supports them over the loopback HTTP.

## Auth boundary

The desktop session-token check in `src/proxy.ts` and `assertDesktopAuth()` still applies. Any new route (`/signals/*`, `/events`) gets the same guard — explicitly, not implicitly. This is a CLAUDE.md "do not regress" rule.

For the cloud cluster (web), the Temporal client connection itself is authenticated (mTLS or API key); the *user*-facing API still needs whatever session/auth scheme the hosted product uses.

## State management in the studio

If we go U2 or U3 (render path only), the studio's existing "job is in `processing` status" state model needs a small extension: jobs now have a stream of progress events, not just a status enum. The simplest model is:

```
type JobUiState = {
  jobId: string;
  status: 'draft' | 'transcribing' | 'planning' | 'rendering' | 'completed' | 'failed' | 'cancelled';
  progress?: { phase: string; percent?: number; message?: string };
  events: UiEvent[];   // append-only, capped at last N
}
```

Components subscribe to the EventSource and reduce events into this shape. The list view (`runtime/jobs.json` denormalized view) reads only `status`.

## Out of scope for U-shape decisions

- The Temporal Web UI access for desktop debugging. That's an `EMBEDDED_ELECTRON.md` concern, surfaced as a link in dev tools, not part of the studio UI.
- Multi-tab collaboration. Even with Option Y + U2, the workflow is the source of truth, but conflict resolution between concurrent signals from two tabs of the same user isn't an existing problem we're solving. Note for `OPEN_QUESTIONS.md` if it ever comes up.

## Migration order if Phase 2 ships

1. Add Temporal-backed `/api/render` alongside the existing one (feature flag).
2. Add SSE `/api/jobs/:id/render/events` endpoint.
3. Update the studio's render trigger + progress display to use the new flow.
4. Verify in dev. Cut over the feature flag.
5. Delete the old `worker.ts` in-memory queue.

Steps 1–3 are independent and reviewable separately.
