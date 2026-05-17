# Premiere Export — Research and Plan

Companion to [TASK.md](TASK.md).

## Background

WeatherV1's render pipeline persists a complete editorial plan to disk before ffmpeg ever runs. The relevant boundary objects:

- Plan bundle persisted at `src/server/jobs/plan-bundle.ts:95-108`, written to `runtime/outputs/forecast_<jobId>.plan.json` (schema: `PlanBundleSchema` in `src/shared/types.ts:230-244`).
- `ResolvedPick` (per-clip record with `audio_start/audio_end` for sequence placement and `video_start/video_end` for source-clip trim) at `src/shared/types.ts:164-170`.
- `Scene` (with `title_he`, `narration`, `start_sec`, `end_sec`, `mood`) at `src/shared/types.ts:131-142`.
- Catalog parser resolves absolute clip paths at `src/server/catalog/parser.ts:78-129`; the resulting `ParsedVideo.path` is what the renderer feeds into ffmpeg's `-i` flags.
- Whisper segments (timed transcript chunks suitable for SRT) at `src/shared/types.ts:112-118`.
- Current ffmpeg invocation at `src/server/ffmpeg/renderer.ts:39-177` — useful as parity reference (sequence settings, scale/crop math, audio mix).

The proposed export does not modify the render pipeline; it adds a parallel "export" path that consumes the same plan bundle and writes a Premiere-importable project alongside the existing MP4 output.

## Integration Shapes Compared

| Shape | What it is | Pros | Cons |
| --- | --- | --- | --- |
| **FCP7 XML export** _(recommended)_ | Emit an `.xml` file in the legacy Final Cut Pro 7 XML Interchange format. Premiere imports it natively as a sequence with clips, trims, audio tracks, and markers. | No Adobe SDK; deterministic; well-documented schema; works offline; one TypeScript serializer and one route handler. | Older format; some metadata (advanced effects, colour) is limited; clip paths are embedded in the XML so portability needs care. |
| **CEP / UXP panel plugin** | Adobe extension that lives inside Premiere, calls WeatherV1's local API at `127.0.0.1:3765`, and builds sequences via Premiere's scripting API. | Live "pull from WeatherV1" UX; richer interaction (browse jobs, re-pull, parameterise); programmatic access to effects, colour labels, marker comments. | Significant Adobe-side build (manifest, signing, install flow); requires Premiere to reach the desktop API across process/network boundaries; a second codebase to maintain. |
| **OpenTimelineIO (OTIO)** | Emit a `.otio` file (open JSON timeline format). Premiere imports via the OTIO plugin; also opens in Resolve, Avid. | Portable across NLEs; clean schema; healthy ecosystem in Python. | Requires the user to install the OTIO plugin in Premiere; less common in Premiere-first shops. |
| **EDL / AAF** | Classic interchange formats. | Universally supported; trivial EDL writer (text). | EDL is single-track and very lossy; AAF needs a library and is overkill for this workflow. Useful only as a fallback. |

## Recommendation

Ship **FCP7 XML export** as v1. It hits every "Done means" criterion in TASK.md with a single TypeScript serializer plus one route handler, requires no Adobe-side install, and leaves a clean upgrade path: a CEP/UXP panel can be built later as a richer alternative without breaking the file-handoff workflow.

## Data Mapping (FCP7 XML)

| WeatherV1 field | FCP7 XML element | Notes |
| --- | --- | --- |
| `PlanBundle.job_id` | `<sequence id="...">` and project `<name>` | Stable per-job identifier. |
| 1080 × 1920, 9:16, 30 fps | `<rate>`, `<format>` | Hard-coded v1; detect later if needed. |
| `timeline: ResolvedPick[]` | Ordered `<clipitem>` entries inside a video `<track>` of `<media><video>` | One clipitem per pick. |
| `ResolvedPick.audio_start` / `audio_end` | `<start>` / `<end>` on the sequence timeline | Convert seconds → frames at sequence fps. |
| `ResolvedPick.video_start` / `video_end` | `<in>` / `<out>` on the source `<file>` reference | Same fps conversion. |
| Resolved absolute source path | `<file>` + `<pathurl>file://...</pathurl>` with a stable `id` | Re-use the `id` across clipitems that point at the same source so Premiere collapses them in the Project panel. |
| Voiceover MP3 (`audio_filename`, full duration) | Second `<track>` in `<media><audio>` | Spans `0` → `duration_sec`. |
| Generated SRT (see below) | Third `<track>` carrying a subtitle clipitem | Optional; toggleable in Premiere. |
| `scenes[].title_he` + `start_sec` | Sequence `<marker>` entries | Visible in Premiere's timeline ruler. |
| `picker_reason` / `validator` notes | Per-clipitem `<comment>` | Surfaces editorial rationale in the Notes column. |

## Captions / SRT

The current renderer burns no captions. As part of this export, emit `forecast_<jobId>.srt` derived from `plan_bundle.transcript_segments` — one cue per Whisper segment, timestamps formatted as `HH:MM:SS,mmm`. The FCP7 XML references the SRT as a subtitle clip on a third track so the editor can toggle it on/off in Premiere.

A small utility (`src/server/export/srt.ts` in the future implementation) converts `WhisperSegment[]` to an SRT string. No new dependency required.

## Clip Path Strategy

V1 ships **absolute paths** in the XML. This matches the current `videoMap` behaviour, gives zero surprises on the same machine that produced the plan, and avoids guesswork about a media root. The serializer stamps the workspace root into the XML as a comment so a future "relativise" or "bundle media folder" mode can opt in without breaking earlier exports.

## File / Path Plan (for the future implementation session)

These are not created in the docs session — they are the work to do later:

- `src/server/export/fcp7-xml.ts` — pure serializer over `PlanBundle` + `videoMap`.
- `src/server/export/srt.ts` — `WhisperSegment[]` → SRT string.
- `src/app/api/export/premiere/[jobId]/route.ts` — GET endpoint returning a zip of `.xml` + `.srt`; guarded with `assertDesktopAuth()` like sibling routes.
- UI button wired into `src/client/components/studio/OutputCard.tsx` (and/or `RenderCard.tsx`), modelled on the existing `downloadJsonFile` helper at `src/client/lib/download-json-file.ts`.
- Unit-test fixtures under `src/test/` against a sample plan bundle.

## Milestones (future)

1. FCP7 XML serializer + unit tests against a fixture plan bundle.
2. SRT writer + unit tests.
3. Export route + desktop auth.
4. UI button + smoke test in Electron.
5. Manual Premiere import verification on Windows and macOS.

## Verification (for the future implementation, not this docs session)

```bash
npx tsc --noEmit
npm test
npm run build
```

Manual checks:

- Generate a plan in dev, hit the export endpoint, get `.xml` + `.srt`.
- Open the `.xml` in Premiere Pro (Windows + macOS): sequence appears with all clips at the right in/out and sequence positions, voiceover plays, markers show Hebrew scene titles, SRT toggles on the subtitle track.
- Clip notes column shows the picker's reason for each clip.

## Non-Goals

- No round-trip from Premiere back into WeatherV1.
- No `.prproj` binary generation.
- No Premiere render automation.
- No multi-job batch export.
