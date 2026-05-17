# Future Task: Adobe Premiere Pro Export

## Goal

Let users hand the planned timeline off to Adobe Premiere Pro for manual polish and final render, as an alternative to the built-in ffmpeg renderer.

## Why Now

The current ffmpeg pipeline (`src/server/ffmpeg/renderer.ts`) does a clean clip concat with voiceover and no overlays. Editors who want fine-grained control — branded titles, manual cut tweaks, alternate codecs, custom transitions, colour grading — cannot get that from the desktop app today. Premiere Pro is the dominant NLE for that audience, and the editorial plan WeatherV1 produces is already serialised cleanly (the plan bundle JSON), so the handoff is a much smaller change than re-implementing Premiere-class editing in-app.

## Render Boundary

By the time `src/server/jobs/worker.ts:79-85` is reached, the system has:

- A validated `ResolvedPick[]` timeline with per-clip in/out points and per-clip sequence start/end (`src/shared/types.ts:164-170`).
- A scene list with Hebrew titles, narration text, and mood (`src/shared/types.ts:131-142`).
- A voiceover MP3 at a known path.
- A catalog map with absolute clip paths (`src/server/catalog/parser.ts:78-129`).
- Whisper transcript segments suitable for SRT generation (`src/shared/types.ts:112-118`).

Everything Premiere needs to reconstruct a sequence is already in memory at that line.

## Done Means

- From a completed plan (job phase `planned` or `done`), the user clicks an export button in `RenderCard.tsx` or `OutputCard.tsx` and downloads a Premiere-importable project file plus a sidecar SRT.
- Opening that file in Premiere Pro reconstructs the sequence: correct clip order, correct in/out points, voiceover on its own track, captions on a subtitle track, 1080×1920 9:16 sequence settings, 30 fps.
- Scene boundaries appear as Premiere sequence markers labelled with the Hebrew `title_he` for fast navigation.
- Editorial reasoning (`picker_reason`, validator notes) shows up as per-clip notes in Premiere's Notes column so editors can see why each clip was chosen.

## In Scope

- Export-only path (one-way handoff; no round-trip).
- Single job at a time.
- Both desktop (Electron) and web runtimes — render code is shared (`src/server/**`).
- SRT generation from the existing transcript.

## Out Of Scope

- Round-tripping Premiere edits back into WeatherV1.
- Writing native binary `.prproj` files (undocumented format).
- Automating Premiere's render queue.
- Multi-job batch export.
- Re-implementing graphics/effects from the AE side (covered by the sibling [`../after-effects-graphics/`](../after-effects-graphics/) research).

## Resolved (research pass)

- **Clip path strategy** → absolute `file://` paths in v1; workspace root stamped as an XML comment so a future "relativise" mode can opt in without breaking earlier exports. Evidence: `src/server/catalog/parser.ts:104` already produces absolute paths from `WEATHER_WORKSPACE_DIR` (`src/server/runtime/config.ts:59-67`).
- **Web vs desktop** → desktop-only in v1. Web returns `501 Not Implemented`; the UI button is hidden on web. Reason: clip files have no public HTTP route (`src/proxy.ts:28-49`), so `file://` paths emitted on web would be unresolvable, and bundling source clips into a zip would ship multi-GB media redundantly to desktop users who already have them locally. Gate the route with both `assertDesktopAuth()` and `isDesktopMode()` (`src/server/runtime/auth.ts:18-25`).
- **Frame rate** → hard-code 30 fps in the FCP7 sequence; convert seconds → frames as `Math.round(sec * 30)`. The catalog does not record per-clip fps (`ParsedVideo` has no fps field; `ProbeResult` doesn't extract it), and the renderer itself doesn't pass `-r`. Editors routinely conform mixed-rate sources to a sequence rate. Leave a `TODO(premiere-fps-detect)` for a future "ffprobe the first clip" enhancement.

## Plan

See [PLAN.md](PLAN.md).
