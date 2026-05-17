# Idempotency Convention for Temporal Activities

## Why this matters

Temporal's retry policy will happily re-run a failed activity. Without discipline, this means:

- **Whisper transcripts get re-billed** every time the activity retries.
- **LLM picker calls double-charge** on transient errors.
- **R2 PUTs duplicate** if the success response gets eaten by a network blip.

The Temporal docs are clear: "activities must be idempotent." But what that actually requires in WeatherV1 is concrete enough to write down, so it doesn't become a per-PR judgment call.

## The core rule

> **Every activity is safe to call N times for the same inputs. The plan bundle (or an equivalent on-disk cache) is the durable result store.**

A failed activity that retries should hit the cache and return the prior result *instantly*, without re-paying the external cost.

## The nine conventions

### 1. Deterministic dedup keys, derived from inputs only

No timestamps, no UUIDs, no random. Same inputs → same key → same cached result.

| Activity | Dedup key shape |
| --- | --- |
| `whisperTranscribe` | `whisper:${jobId}:${sha256(audioBytes)}` |
| `runScenePlanner` | `plan:${jobId}:${sha256(transcript)}:${promptVer}` |
| `runPickerOnce` | `pick:${jobId}:${sha256(scenes)}:${catalogRev}:${promptVer}` |
| `runFfmpeg` | `render:${jobId}:${sha256(timeline)}` |
| `mirrorR2(key, content)` | `r2:${key}:${sha256(content)}` |

If two different inputs ever produce the same key, that's a correctness bug, not a feature.

### 2. Activity skeleton: read-cache → call → write-cache

```
async function someActivity(input, ctx) {
  const key = computeDedupKey(input);
  const cached = await readCachedResult(input.jobId, key);
  if (cached && !input.forceFresh) return cached;

  const result = await callExternalThing(input);

  await writeCachedResult(input.jobId, key, result);
  return result;
}
```

The write happens **after** the external call succeeds but **before** the function returns. A crash between the external call and the cache write means the next retry re-calls the API — annoying but acceptable (and rare enough to ignore for now).

### 3. Provider idempotency headers when supported

OpenAI accepts an `Idempotency-Key` header on most write endpoints. Pass our dedup key there. This protects the **worst case**: the API succeeds, the network eats the response on the way back, Temporal records the activity as failed, retry hits the API again — without the header you get billed twice; with the header you get the cached result on the second call.

Anthropic's idempotency story has been evolving; check current state when implementing. If unsupported, accept the small risk.

### 4. `promptVersion` is a first-class input to every LLM activity

When we change a prompt, cached results from the old prompt are no longer valid. Baking the prompt version into the dedup key forces correct invalidation. Existing constants in `src/server/pipeline/scene-planner.ts` and `src/server/pipeline/picker.ts` become explicit activity inputs rather than implicit module imports.

### 5. `catalogRev` invalidates picker cache

The catalog mutates when users add clips, when R2 sync brings in remote changes, when the studio reorganises footage. The picker's dedup key includes a `catalogRev` so adding a new clip correctly invalidates yesterday's picker result instead of silently returning a stale plan.

How to compute `catalogRev`: monotonic counter persisted alongside `catalog.json`, incremented on every write. Or a hash of `catalog.json` if we want it content-derived. Either works.

### 6. `forceFresh: boolean` escape hatch on every activity

Each activity accepts `forceFresh`. When true, skip the cache read but still write the cache after. This is what the studio's "replan this scene" button triggers — the user is explicitly saying "ignore the cache, I want a new result."

### 7. Workflows are NOT idempotent — only activities are

Don't try to make workflows themselves dedup-able. Trust Temporal's workflow-id-based deduplication: every job uses a deterministic `workflowId` like `weatherv1:job:${jobId}`, and Temporal rejects duplicate starts via `WorkflowIdReusePolicy`. That's it; we don't reinvent it.

### 8. Non-cacheable activities must be intrinsically idempotent

Some activities have no useful cache target:

- `notifyUser(message)` — sending the same notification twice is a UX bug. Recipient-side dedup or "have I already sent this" check.
- `cleanupScratch(path)` — must tolerate the file not existing.
- `sendWebhook(url, payload)` — include an idempotency key the receiver respects.

These get a comment at the top explaining *why* they don't use the cache pattern.

### 9. Cache invalidation triggers from session signals (Option Y only)

If the long-lived `JobSessionWorkflow` shape (Option Y from [`PIPELINE_MAPPING.md`](PIPELINE_MAPPING.md)) is adopted, the workflow holds in-memory revision numbers (`transcriptRev`, `planRev`, `timelineRev`). User-edit signals increment the relevant rev. Downstream activity dedup keys include the rev, so one signal correctly invalidates a chain of caches (edit transcript → plan + pick + render caches all auto-invalidate without explicit purges).

## What this buys

- **Replays are free.** Killing and restarting the worker re-runs activities, all hit cache, return instantly. Crash-resume cost ≈ 0.
- **Cost isn't doubled by Temporal's retry policy.** Whisper bills you once even if the activity retries 5 times.
- **Plan bundle becomes the persistent state machine.** Today's plan bundle already does this informally; the cache section makes it rigorous.
- **Testing is simpler.** Activities are pure functions of `(input, cache state) → result`. Easy to unit-test.

## What this costs

### Discipline tax
Every activity needs the read-cache/call/write-cache skeleton. Easy to forget on a hurried PR. Worth a lint rule or codegen template if we go deep.

### Plan-bundle bloat
Caching every activity result in the plan bundle makes the bundle bigger forever. Mitigations to consider:
- **Eviction policy** — `cache.{activityKey}.lastReadAt`, evict entries unread for >30 days.
- **External cache store** — keep small results (timestamps, hashes) in the bundle; spill large results (transcripts, timelines) to a sibling `forecast_<jobId>.cache.json` that doesn't get mirrored to R2 every change.
- **No-cache-needed for some activities** — e.g. don't bother caching `writeOutputUrlToPlanBundle`'s result.

This is unresolved — see [`OPEN_QUESTIONS.md`](OPEN_QUESTIONS.md).

### Concurrent writes
Today's plan bundle uses incremental JSON merge, which is safe for one writer at a time. If Temporal parallelises activities (e.g. running multiple `runPickerOnce` invocations concurrently for different scenes), we may need a real per-job lock around bundle writes. Possibly solvable with workflow-side serialisation (the workflow doesn't kick off two cache-mutating activities at once for the same key).

## Pre-implementation checklist

Before any Temporal activity code is written, lock down:

- [ ] Where the cache lives — plan bundle? sibling file? separate KV?
- [ ] Eviction policy
- [ ] Schema for cache entries (key → {result, writtenAt, schemaVer})
- [ ] How `promptVer` and `catalogRev` are computed and persisted
- [ ] Whether providers other than OpenAI/Anthropic respect idempotency headers (matters if we add Gemini activity calls)
- [ ] A linter rule or template that enforces the read-cache/call/write-cache skeleton
