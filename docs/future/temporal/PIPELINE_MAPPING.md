# Pipeline Mapping — Existing Steps → Temporal Workflows

## Goal

Map every step of WeatherV1's existing pipeline onto Temporal workflow and activity boundaries. This is the input that determines what code gets written when (if) Phase 2 starts.

## The existing pipeline (for reference)

```
audio.mp3
  │
  ├─ POST /api/transcribe ────► Whisper API ──► transcript + segments ──► plan bundle
  │
  ├─ POST /api/plan ──────────► scene planner LLM ──► scenes ──► plan bundle
  │                              picker LLM (+ validator retry loop) ──► timeline ──► plan bundle
  │
  ├─ POST /api/render ────────► in-memory queue ──► ffmpeg ──► forecast_<jobId>.mp4
  │
  └─ (background) R2 mirror queue ──► durable PUTs of catalog / plan bundles / videos / posters / voiceovers
```

## Activity boundaries

A Temporal activity should be one **atomic, retryable unit of external work**. WeatherV1's natural activity set:

| Activity | Wraps | External calls | Idempotent via |
| --- | --- | --- | --- |
| `whisperTranscribe(audioRef)` | `transcribeAudio()` in `src/server/whisper/` | OpenAI Whisper | Dedup key `whisper:${jobId}:${sha256(audioBytes)}`, result cached in plan bundle |
| `runScenePlanner(transcript, promptVer)` | `planScenes()` in `src/server/pipeline/scene-planner.ts` | Claude / OpenAI | Dedup key `plan:${jobId}:${sha256(transcript)}:${promptVer}` |
| `runPickerOnce(scenes, catalogRev, promptVer)` | One iteration of the picker (validator retry loop *inside* the activity) | Claude / OpenAI | Dedup key `pick:${jobId}:${sha256(scenes)}:${catalogRev}:${promptVer}` |
| `ensureLocalClips(timeline)` | No-op on desktop; on cloud render workers, pulls referenced catalog clips from R2 | R2 gateway GETs | Idempotent by nature (file presence check) |
| `runFfmpeg(timeline)` | `renderVideo()` in `src/server/render/` | Local ffmpeg binary | Idempotent — output path includes `jobId`, overwrite is safe |
| `mirrorR2(key, contentRef)` | `putR2Text` / `uploadR2File` in `src/server/sync/r2/client.ts` | R2 gateway PUTs | Dedup key `r2:${key}:${sha256(content)}` |
| `notifyOriginIfRemote(mp4Path)` | Used only on hosted-web cloud render path (future) — streams MP4 back to the user's machine or pre-signs a download URL | R2 scratch prefix, or direct WS push | Intrinsically idempotent |

All idempotency conventions are detailed in [`IDEMPOTENCY.md`](IDEMPOTENCY.md).

## Workflow boundaries

There are two plausible decompositions. The brainstorm leaned toward **Option Y** (long-lived session workflow) but flagged it as having real versioning cost. Both are kept here for reference.

### Option X — Per-action workflows (simpler)

Each user action triggers its own short-lived workflow that completes when the action does.

```
TranscribeWorkflow(jobId, audioRef)
  ├─ activity: whisperTranscribe
  └─ activity: writeTranscriptToPlanBundle

PlanWorkflow(jobId)
  ├─ activity: runScenePlanner
  ├─ activity: runPickerOnce  (with retry policy, validator runs inside the activity)
  └─ activity: writeTimelineToPlanBundle

RenderWorkflow(jobId)
  ├─ activity: ensureLocalClips
  ├─ activity: runFfmpeg
  └─ activity: writeOutputUrlToPlanBundle

R2MirrorWorkflow  ← long-running, see R2_MIRROR_PHASE1.md
```

- **Pros**: simple lifecycle, easy to reason about, versioning is trivial (workflows are short).
- **Cons**: loses the "job is one observable thing" property; doesn't model interactive editing well; replan-a-single-scene becomes a totally separate workflow.

### Option Y — `JobSessionWorkflow` as the parent (richer)

One long-running workflow per job, lives from "audio uploaded" to "user finished editing."

```
JobSessionWorkflow(jobId, audioRef)
  │
  │  ▼ on start
  ├─ child: TranscribeChildWorkflow
  ├─ child: PlanChildWorkflow
  │
  │  ▼ enters "editing" state, awaits signals
  ├─ on signal `replanScene(idx)`     → child: ReplanSceneChildWorkflow
  ├─ on signal `editTimeline(...)`    → activity: applyTimelineEdit (no LLM)
  ├─ on signal `requestRender()`      → child: RenderChildWorkflow
  ├─ on signal `addVoiceover(...)`    → child: VoiceoverChildWorkflow
  ├─ on signal `complete()`           → terminate cleanly
  └─ on signal `cancel()`             → terminate, mark job cancelled
```

Periodic `continueAsNew` once the workflow's history exceeds ~50k events (Temporal's recommended ceiling for a single execution).

- **Pros**: matches how users actually use the app (one long editing session); replan / edit / re-render flows are natural; Temporal Web UI shows the full history of edits per job.
- **Cons**: revives the versioning problem (see [`VERSIONING.md`](VERSIONING.md)) — long-lived workflows mean app upgrades hit `patched()` boundaries; `runtime/jobs.json` becomes a denormalized view, not source of truth; bigger refactor of how the UI thinks about job state.

### Recommendation

Start with Option X for Phase 1–2 (mirror queue + crash-safe renders). Migrate the orchestration layer to Option Y only if Phase 2 surfaces a real need (e.g., the studio's replan-one-scene feature feels awkward as a separate workflow). The activities themselves don't change between the two options, so the work isn't wasted.

## Signals you'd want eventually

| Signal | Purpose | Workflow it targets |
| --- | --- | --- |
| `cancel` | User clicks stop | Whatever's currently running |
| `replanScene(sceneIdx, hint?)` | User: "redo just scene 3" | `JobSessionWorkflow` (Y) or starts a fresh `ReplanSceneWorkflow` (X) |
| `editTranscript(diff)` | User edits the transcript before plan | `JobSessionWorkflow` only — invalidates downstream caches |
| `requestRender()` | User clicks render after editing | `JobSessionWorkflow` only |
| `enqueueR2Op(key, contentRef)` | Anywhere that wants to mirror | `R2MirrorWorkflow` |
| `forceR2Drain()` | Debug / "sync now" button | `R2MirrorWorkflow` |

## What does NOT become a workflow

- **Reading the catalog.** It's a fast disk read. No need for orchestration.
- **Auth / session-token checks.** Stay in HTTP middleware.
- **Plan-bundle JSON merges.** They're a primitive used inside activities, not their own activity.
- **The validator loop inside the picker.** It belongs *inside* `runPickerOnce` so it counts as a single retryable unit, with its own internal retry budget separate from Temporal's activity retry policy.

## What's interesting that the existing code already does well

- **Plan bundle as the durable per-job artifact** is exactly the right shape for being the activity-result cache. No restructuring needed — just an additive `cache: { [dedupKey]: result }` section.
- **`crashRecoverySweep()`** already implements the spirit of workflow resumption. Temporal subsumes it cleanly.
- **The R2 mirror queue's coalescing-by-key** is the one piece of existing logic that doesn't map trivially. See [`R2_MIRROR_PHASE1.md`](R2_MIRROR_PHASE1.md) for three ways to preserve it.
