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

## Status — implemented 2026-05-20

Shipped as a download-link export on **web + desktop**. Files:
- `src/server/export/fcp7-xml.ts` — pure FCP7 (XMEML v5) serializer (`buildFcp7Xml`).
- `src/server/export/srt.ts` — `WhisperSegment[]` → SRT (UTF-8 BOM).
- `src/app/api/export/premiere/[jobId]/route.ts` — `GET`, `assertDesktopAuth`, streams an `archiver` zip of `{ .xml, .srt, README.txt, media/* }`.
- `src/server/export/media-bundle.ts` — for each pick, materializes the source (local copy or R2 download), probes dimensions, then ffmpeg-trims the clip's cut **+ a 1 s handle on each side** into a per-pick `media/<name>` segment.
- UI: a sibling "ייצוא לפרימייר" button in `src/client/components/studio/RenderCard.tsx`, wired through `StudioPanel.tsx` (`handleExportPremiere`).
- Deps added: `xmlbuilder2`, `archiver`. Tests: `src/test/export-srt.test.ts`, `src/test/export-fcp7-xml.test.ts`, `src/test/export-clip-window.test.ts`.

**Self-contained bundle:** all media is embedded under `media/` (trimmed clips + voiceover + bg-music asset), so nothing goes offline. The XML uses **relative co-located paths** (`media/<name>`); on import Premiere relinks by filename from the extracted folder. Each clip is bundled **trimmed to its cut plus a ~1 s handle on each side** (`clipTrimWindow`, libx264/yuv420p re-encode), so the zip stays small while the editor keeps a second of slack to nudge either edge; FCP7 in/out are rebased onto the trimmed file's clock. Background music is a looped **-16 dB** track; captions ship as a **sidecar** `.srt`. The zip is **streamed** (archiver, STORE) so total media size doesn't bound memory. Remaining: manual Premiere import verification on Windows + macOS; `premiere-fps-detect` still deferred (30 fps hard-coded).

## Integration Shapes Compared

| Shape | What it is | Pros | Cons |
| --- | --- | --- | --- |
| **FCP7 XML export** _(recommended)_ | Emit an `.xml` file in the legacy Final Cut Pro 7 XML Interchange format. Premiere imports it natively as a sequence with clips, trims, audio tracks, and markers. | No Adobe SDK; deterministic; well-documented schema; works offline; one TypeScript serializer and one route handler. | Older format; some metadata (advanced effects, colour) is limited; clip paths are embedded in the XML so portability needs care. |
| **CEP / UXP panel plugin** | Adobe extension that lives inside Premiere, calls WeatherV1's local API at `127.0.0.1:3765`, and builds sequences via Premiere's scripting API. _(v2 path — fully researched in [PLUGIN.md](PLUGIN.md): recommended CEP-now-then-UXP, ~4–6 days build.)_ | Live "pull from WeatherV1" UX; richer interaction (browse jobs, re-pull, parameterise); programmatic access to effects, colour labels, marker comments. | Significant Adobe-side build (manifest, signing, install flow); requires Premiere to reach the desktop API across process/network boundaries; a second codebase to maintain. |
| **OpenTimelineIO (OTIO)** | Emit a `.otio` file (open JSON timeline format). Premiere imports via the OTIO plugin; also opens in Resolve, Avid. | Portable across NLEs; clean schema; healthy ecosystem in Python. | Requires the user to install the OTIO plugin in Premiere; less common in Premiere-first shops. |
| **EDL / AAF** | Classic interchange formats. | Universally supported; trivial EDL writer (text). | EDL is single-track and very lossy; AAF needs a library and is overkill for this workflow. Useful only as a fallback. |

## Recommendation

Ship **FCP7 XML export** as v1. It hits every "Done means" criterion in TASK.md with a single TypeScript serializer plus one route handler, requires no Adobe-side install, and leaves a clean upgrade path: a CEP/UXP panel can be built later as a richer alternative without breaking the file-handoff workflow.

### Sanity-check (research pass)

Re-examined the four shapes against the runtime and re-confirmed FCP7 XML for v1:

- **OTIO** would be cleaner schema-wise, but Premiere only imports `.otio` via a user-installed plugin. Forcing every editor to install it negates the "just open the file" UX.
- **CEP/UXP** is the strongest editor experience but is a second codebase, signing flow, and cross-process auth — disproportionate for a v1 handoff. Defer.
- **EDL** is single-track and would lose voiceover + markers + per-clip notes (all four "Done means" criteria). **AAF** needs a library and is overkill.
- **FCP7 XML** stays the right v1: one TypeScript serializer, no Adobe-side install, hits every "Done means" bullet, schema is well-documented enough to hand-roll without a third-party library.

### Runtime scope

**Web and desktop, via a download link.** *Updated 2026-05-20 — supersedes the earlier desktop-only resolution.* The export route mirrors `/api/render`'s auth: `assertDesktopAuth()` passes on web (where `isDesktopRequestAuthorized()` returns `true` immediately) and the proxy middleware enforces the `weather_editor_session` cookie; desktop still requires the `x-weather-desktop-token` header. No `isDesktopMode()` gate, no 501 — the button shows wherever Render does. Delivery is a browser download of `forecast_<jobId>_premiere.zip` (fetch → blob → `<a download>`), identical on both runtimes. The emitted `file://` paths are absolute: they resolve for a local-first web user (the server has the media locally); a remote web user relinks media in Premiere (the bundle README explains this).

## Web-research refresh (2026-05-20)

A fresh web pass re-validated the four shapes against the current Premiere Pro line (26.x, build 26.3). The v1 recommendation holds; three points updated:

- **FCP7 XML is alive and maintained, not deprecated.** Premiere 26.x still imports legacy FCP7 XMEML `.xml` via File > Import, and Adobe *expanded* XML interchange this cycle (selective per-sequence export to XML/AAF; a UNC-vs-mapped-drive path-mapping bug was fixed). No deprecation notice surfaced. This strengthens the v1 bet. ([Adobe — Import FCP XML](https://helpx.adobe.com/premiere-pro/using/importing-xml-project-files-final.html), [What's new](https://helpx.adobe.com/premiere-pro/using/whats-new.html))
- **OTIO is STILL beta-only.** Despite 2+ years in Premiere Beta, OTIO import/export had not crossed into the stable channel as of 2026-05 (Larry Jordan, 2026-05-03, labels Premiere OTIO "(beta)"; Adobe, Feb 2025: "We're not there yet"). The OTIO-successor path in [Forward path (v2)](#forward-path-v2--not-v1) remains premature — keep FCP7 XML as the file-handoff bet. ([Larry Jordan](https://larryjordan.com/articles/opentimelineio-now-supported-on-final-cut-premiere-and-resolve/))
- **SRT Hebrew/RTL requirements unchanged.** UTF-8 **BOM** is still required for Premiere to decode non-Latin SRT, and the Track Settings → Text Engine → *South Asian and Middle Eastern* toggle is still needed for RTL rendering. The milestone-2 BOM decision and the bundled-README note both stand. ([Adobe community](https://community.adobe.com/t5/premiere-pro-discussions/srt-import-with-right-to-left-language-e-g-hebrew-arabic-text-is-reversed/m-p/11909031))

**MCP servers — not needed for this feature.** The export is a deterministic server-side serializer (plan bundle → `.xml` / `.srt`) with no external side-effects, so an MCP tool surface adds nothing. The MCP registry has no NLE / FCPXML / OTIO / ffmpeg connectors as of 2026-05. The "live in-Premiere" integration is the CEP/UXP panel ([PLUGIN.md](PLUGIN.md)), which is an Adobe extension, not an MCP. No MCP config change is warranted.

## Data Mapping (FCP7 XML)

| WeatherV1 field | FCP7 XML element | Notes |
| --- | --- | --- |
| `PlanBundle.job_id` | `<sequence id="...">` and project `<name>` | Stable per-job identifier. |
| 1080 × 1920, 9:16, 30 fps | `<rate>`, `<format>` | Hard-coded v1; `Math.round(sec * 30)` for all timeline math. Catalog has no per-clip fps (`ParsedVideo` / `ProbeResult`), and the renderer doesn't pass `-r`. Leave `TODO(premiere-fps-detect)` for a later ffprobe-based detection. |
| `timeline: ResolvedPick[]` | Ordered `<clipitem>` entries inside a video `<track>` of `<media><video>` | One clipitem per pick. |
| `ResolvedPick.audio_start` / `audio_end` | `<start>` / `<end>` on the sequence timeline | Convert seconds → frames at sequence fps. |
| `ResolvedPick.video_start` / `video_end` | `<in>` / `<out>` into the trimmed clip | The AI-planned cut, **rebased** onto the trimmed segment's clock (sits ~1 s in from the head). |
| Bundled clip file | `<file>` + `<pathurl>media/<name></pathurl>` with a per-pick `id` | **Relative, co-located** path (not `file://`); media embedded under `media/`. One trimmed segment per timeline pick (cut + 1 s handles), so each gets its own `id`. |
| Voiceover MP3 (`audio_filename`, full duration) | First audio `<track>` in `<media><audio>` | Spans `0` → `duration_sec`. |
| Background music (bundled default, `getDefaultBgMusicPath()`) | Second audio `<track>` of looped `<clipitem>`s at **-16 dB** via an `audiolevels` filter | Looped to fill `duration_sec` (last loop trimmed) — mirrors the renderer's `-stream_loop -1` + amix level. **Implemented.** |
| Generated SRT | **Sidecar** `forecast_<jobId>.srt` in the zip (UTF-8 BOM), not an embedded subtitle track | FCP7 subtitle-track import is unreliable; editor drags the `.srt` onto a caption track (README explains the RTL Text Engine toggle). |
| `scenes[].title_he` + `narration` + `start_sec` | Sequence `<marker>` (`name` + `comment`) | Visible in Premiere's timeline ruler. |
| `picker_reason` ?? `fallback_reason` ?? `reason` | Per-clipitem `<comments><mastercomment1>` | Surfaces editorial rationale in the Notes column. |

## Captions / SRT

The renderer burns no captions, so the export emits `forecast_<jobId>.srt` from `plan_bundle.transcript_segments` — one cue per Whisper segment, timestamps `HH:MM:SS,mmm`, **UTF-8 with BOM** (Premiere mis-decodes non-Latin SRT without it). Shipped as a **sidecar** in the zip (not an embedded subtitle track — FCP7 subtitle-track import is unreliable); the editor drags it onto a caption track and sets Text Engine → South Asian and Middle Eastern for RTL.

`src/server/export/srt.ts` converts `WhisperSegment[]` → SRT (no new dependency).

## Clip Path Strategy

**Resolved (2026-05-20): self-contained bundle.** The zip embeds all media under `media/` (full source clips + voiceover + bg music) and the XML references it with **relative, co-located** paths (`media/<name>`, unique ASCII names). Per web research, Premiere doesn't reliably resolve relative `pathurl`s directly, but it **relinks by filename** from the folder the `.xml` is opened in — so an extracted bundle resolves (some builds need a one-time "Locate → Relink others automatically"). This supersedes the earlier absolute-`file://` plan, which produced "media offline" whenever the clips weren't already on the importing machine. Alternatives rejected: FCPXML needs a converter Premiere can't run; embedded-media AAF is audio-only / 2 GB-capped / has no Node writer; OTIO `.otioz` bundles aren't imported by Premiere. Clips are bundled **trimmed to their cut plus a ~1 s handle each side** (re-encoded segments), keeping the zip small while leaving the editor a second of slack to adjust either edge.

## FCP7 XML Skeleton

Concrete element tree the v1 serializer should produce. Placeholders in `{…}` come from `PlanBundle` + `videoMap`; constant values reflect the resolved decisions above (1080×1920, 30 fps, absolute paths).

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE xmeml>
<!-- workspaceDir=/Users/.../v1Drive/weather -->
<xmeml version="5">
  <sequence id="seq-forecast_<jobId>">
    <name>forecast_<jobId></name>
    <duration>{round(duration_sec * 30)}</duration>
    <rate><timebase>30</timebase><ntsc>FALSE</ntsc></rate>
    <timecode>
      <rate><timebase>30</timebase><ntsc>FALSE</ntsc></rate>
      <string>00:00:00:00</string>
      <frame>0</frame>
      <displayformat>NDF</displayformat>
    </timecode>
    <media>
      <video>
        <format>
          <samplecharacteristics>
            <width>1080</width><height>1920</height>
            <pixelaspectratio>square</pixelaspectratio>
            <rate><timebase>30</timebase><ntsc>FALSE</ntsc></rate>
          </samplecharacteristics>
        </format>
        <track>
          <!-- one <clipitem> per ResolvedPick, in timeline order -->
          <clipitem id="clip-{pick.idx}">
            <name>{video_id}</name>
            <duration>{round((video_end - video_start) * 30)}</duration>
            <rate><timebase>30</timebase><ntsc>FALSE</ntsc></rate>
            <start>{round(audio_start * 30)}</start>
            <end>{round(audio_end * 30)}</end>
            <in>{round(video_start * 30)}</in>
            <out>{round(video_end * 30)}</out>
            <file id="file-{video_id}">
              <!-- emit the full <file> block once per video_id; later clipitems
                   referencing the same source use <file id="file-{video_id}"/>
                   shorthand so Premiere collapses them in the Project panel -->
              <name>{basename(path)}</name>
              <pathurl>file://{absolute path}</pathurl>
              <rate><timebase>30</timebase><ntsc>FALSE</ntsc></rate>
              <duration>{round(source_duration_sec * 30)}</duration>
              <media>
                <video><samplecharacteristics>
                  <width>{src_width}</width><height>{src_height}</height>
                </samplecharacteristics></video>
              </media>
            </file>
            <comments><mastercomment1>{picker_reason}</mastercomment1></comments>
          </clipitem>
        </track>
      </video>
      <audio>
        <track>
          <clipitem id="vo-track">
            <name>{audio_filename}</name>
            <rate><timebase>30</timebase><ntsc>FALSE</ntsc></rate>
            <start>0</start>
            <end>{round(duration_sec * 30)}</end>
            <in>0</in>
            <out>{round(duration_sec * 30)}</out>
            <file id="file-voiceover">
              <pathurl>file://{absolute voiceover path}</pathurl>
            </file>
          </clipitem>
        </track>
      </audio>
    </media>
    <!-- one <marker> per scene; Premiere shows them on the ruler -->
    <marker>
      <name>{scene.title_he}</name>
      <comment>{scene.narration}</comment>
      <in>{round(scene.start_sec * 30)}</in>
      <out>-1</out>
    </marker>
  </sequence>
</xmeml>
```

**Subtitle caveat:** Premiere's FCP7 importer handles subtitle tracks inconsistently. Implementation milestone 5 should verify; if unreliable, drop the subtitle `<track>` and ship the SRT as a sidecar the editor drags onto a track manually.

## File / Path Plan (for the future implementation session)

These are not created in the docs session — they are the work to do later:

- `src/server/export/fcp7-xml.ts` — pure serializer over `PlanBundle` + `videoMap`. Use **`xmlbuilder2`** (add to `package.json`); it gives deterministic child ordering, fluent `dtd()`/`com()` nodes for `<!DOCTYPE>` and the workspace-root comment, proper attribute escaping, and TypeScript types. (Hand-rolled templating becomes a maintenance trap once Hebrew text + attribute escaping enter the picture; `fast-xml-parser`'s builder is awkward for mixed DOCTYPE/comments.)
- `src/server/export/srt.ts` — `WhisperSegment[]` → SRT string. **Emit UTF-8 with BOM** (`0xEF 0xBB 0xBF` as the first bytes) — Premiere mis-decodes UTF-8 SRTs without a BOM for non-Latin scripts (Hebrew, Arabic, Korean). Timestamps formatted `HH:MM:SS,mmm`.
- `src/app/api/export/premiere/[jobId]/route.ts` — GET endpoint returning a zip of `.xml` + `.srt`; guarded with `assertDesktopAuth()` AND `isDesktopMode()` (web returns 501 per "Runtime scope" above). Use **`jszip`** to buffer the two small files and return the resulting `Buffer` as a `Response` — `archiver` is overkill (it shines for large/many files with Node-stream-to-Web-ReadableStream gymnastics that App Router does not need here).
- UI button wired into `src/client/components/studio/OutputCard.tsx` (and/or `RenderCard.tsx`), modelled on the existing `downloadJsonFile` helper at `src/client/lib/download-json-file.ts`. Hide the button on web.
- Unit-test fixtures: reuse the existing complete Hebrew plan bundle at **[`docs/fixtures/samples/forecast_fixture_demo_complete.plan.json`](../../fixtures/samples/forecast_fixture_demo_complete.plan.json)** (3 scenes, 16 s, real `title_he` strings, transcript_segments, IB001–IB003 timeline) — no new fixture creation needed.

### Source clip width/height — open gap to close in implementation

`ParsedVideo` (`src/shared/types.ts:97-101`) does **not** carry `width`/`height`. They live on `ProbeResult` (`src/server/ffmpeg/probe.ts:7-15`) which is captured on upload but not propagated into the catalog. The FCP7 `<file>` block needs both. Two implementation options:

1. **Probe at export time** — call `probeVideo()` on each unique clip in `videoMap` when the export route runs. One-time per export, fast (metadata-only), zero schema change. **Recommended for v1.**
2. **Extend catalog entry schema** — persist `width`/`height` on first upload so export is zero-cost. Cleaner long-term, but touches catalog write paths, migration, and validator tests. Defer to v2.

### Hebrew / RTL caption surface

The Premiere file format is UTF-8-clean for Hebrew `title_he` in `<marker>` names and SRT cue text; no extra escaping required beyond the XML library's defaults. But Premiere's caption track also has a **UI-level** Text Engine setting (Track Settings → Text Engine → *South Asian and Middle Eastern*) that the editor must toggle for RTL to render correctly. The serializer cannot set this; the export route's response should include a short "what to do in Premiere" README in the zip so users aren't surprised.

## Milestones (future)

1. Add `xmlbuilder2` + `jszip` to `package.json`; write FCP7 XML serializer with unit tests against `docs/fixtures/samples/forecast_fixture_demo_complete.plan.json`.
2. SRT writer (UTF-8 BOM) + unit tests, including a Hebrew round-trip assertion.
3. Probe-at-export helper that fills source `width`/`height` from `videoMap`.
4. Export route + `assertDesktopAuth()` + `isDesktopMode()` gate (web returns 501).
5. UI button (desktop-only, hidden on web) + smoke test in Electron.
6. Manual Premiere import verification on Windows and macOS — confirm markers, notes, Hebrew captions render with Text Engine set to South Asian/Middle Eastern.
7. **(if MOGRT companion greenlit — see below)** Validate Hebrew MOGRT rendering with real V1 captions; ship `.mogrt` + `place-mogrts.jsx` helper in the bundle.

## Optional MOGRT companion (additive)

Research into AE↔Premiere graphics interchange (full write-up in the sibling task at [`../after-effects-graphics/PLAN.md#cross-task-bridge`](../after-effects-graphics/PLAN.md)) surfaced a small additive that improves the editor's Premiere UX without changing the FCP7 XML side:

- **MOGRT (`.mogrt`)** is the only file-handoff graphics-layer interchange Premiere supports. Authored in AE's Essential Graphics Panel; rendered by Premiere via an embedded AE engine — **editor does not need AE installed.**
- **FCP7 XML cannot reference a MOGRT** — it's a `.prproj`-only construct. So the editor's workflow would be: (a) install the `.mogrt` into their Essential Graphics library on first use, (b) run a bundled JSX helper that calls `sequence.importMGT(path, time, vTrack, aTrack)` to auto-place the lower-third at every scene boundary with the Hebrew `title_he` filled in.

If we ship this companion, the export zip grows from `{xml, srt, README}` to `{xml, srt, README, *.mogrt, place-mogrts.jsx}`. The MOGRT itself comes from the AE-graphics task's "dual export from AE master" (the same comp exports both ProRes 4444 for the in-app renderer and `.mogrt` for this bundle), so V1's designer authors once.

**Live risks:**
- **Hebrew MOGRT bug** — community reports of incorrect RTL with punctuation (2024+). Validate against real V1 captions before promising parametric Hebrew text. If it fails, ship the `.mogrt` with generic shapes and the editor types the city manually — the auto-placement at scene timecodes still works.
- **One-time install step** — editors install the `.mogrt` into Essential Graphics on first use. Document in the bundled README.

This stays optional: if V1's designer doesn't deliver MOGRTs, the v1 FCP7 XML + SRT bundle still meets every "Done means" criterion in TASK.md.

## Forward path (v2 — not v1)

Two parallel successors, neither blocking v1:

1. **CEP panel plugin** — richer in-Premiere UX (browse jobs, re-pull, rebuild). Full research and ~4–6 day estimate in **[PLUGIN.md](PLUGIN.md)**. Reuses the v1 plan-bundle → timeline mapping; needs a token-plumbing decision and the same source-clip width/height server gap.
2. **OTIO emitter** — Adobe Premiere Beta now ships **OpenTimelineIO import/export** built-in. FCP7 XML remains supported in CC 2025/2026 but is frozen and undocumented after Apple deprecated FCP 7; OTIO is Adobe's clear forward path for the file-handoff style. When FCP7 XML eventually stops working, a v2 OTIO emitter sharing the same `PlanBundle` → timeline mapping is the natural successor (no editor-side plugin install once OTIO ships in stable Premiere).

The v1 serializer should keep the timeline-mapping logic separable from the XML stringification step so **both** successors can reuse it.

References: [Adobe Help — Import FCP XML](https://helpx.adobe.com/premiere-pro/using/importing-xml-project-files-final.html), [FCPCafe — FCP XML primer](https://fcp.cafe/developer-case-studies/fcpxml/), [Adobe Community — Hebrew/Arabic SRT direction fix](https://community.adobe.com/t5/premiere-pro-discussions/srt-import-with-right-to-left-language-e-g-hebrew-arabic-text-is-reversed/m-p/11908905), [Korean SRT requires UTF-8 BOM](https://community.adobe.com/t5/premiere-pro-discussions/how-to-import-srt-file-with-foreign-language-korean-specifically/td-p/9660115).

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
