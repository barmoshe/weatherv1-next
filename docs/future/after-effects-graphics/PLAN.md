# After Effects Graphic Layers — Discovery Plan

Companion to [TASK.md](TASK.md). This document is **discovery-shaped**: it surveys plausible integration shapes generically because the form of V1's AE assets is not yet known. The "Questions for the technical chat" section is the centrepiece — answering it unblocks the recommendation.

## Background

The current renderer (`src/server/ffmpeg/renderer.ts:39-177`) builds a filter graph that does only `trim → scale/crop → concat → audio mix` with no overlays, no drawtext, and no alpha compositing. Adding graphic layers will therefore take one of two architectural shapes:

1. **Overlay-on-top** — extend the existing ffmpeg filter graph at `src/server/ffmpeg/renderer.ts:107-163` with extra `-i` inputs for graphic streams (PNG sequences or MOVs with alpha) and append `overlay=` nodes after the per-clip scale/crop stage. Cheapest path; doesn't disturb the validated concat logic; ideal for lower-thirds and data overlays.
2. **Two-stage render** — produce the base concat first (today's output), then a second pass composites graphic layers on top with their own timing track derived from `scenes[]`. Cleaner separation of concerns; easier to gate behind a per-job feature flag; ideal for intro/outro cards and transitions that span scene boundaries.

Which pattern fits depends on what V1 hands off and how dynamic the graphics need to be.

## Recommendation up front

Pre-chat research dispatched across the five shapes listed in the TASK file produced a strong default that **doesn't depend on V1's answers**. Treat AE as a design tool whose output (ProRes 4444 MOVs) we consume, not a runtime we integrate. Two ingredients composited via the existing ffmpeg backbone:

1. **Static branded chrome** (logos, intro/outro frames, lower-third backgrounds, animated weather icons) → pre-baked **ProRes 4444 MOV with alpha** in `runtime/workspace/overlays/`. Authored once in AE by V1's designer; exported via AE's standard Render Queue (Apple ProRes 4444 + alpha).
2. **Per-job dynamic Hebrew text** (city, date, temperature, headline) → **SVG template → PNG via [`@resvg/resvg-js`](https://www.npmjs.com/package/@resvg/resvg-js)** at render time. The Rust `resvg` engine uses `rustybuzz` (HarfBuzz port) and renders Hebrew RTL/bidi correctly; ships prebuilt napi-rs binaries for darwin-arm64/x64 + win32-x64 + linux (no native build step); bundles Hebrew fonts via `fontDirs` / `fontBuffers` so users don't need them installed.

Both ingredients composited in a single `filter_complex` extension to [`src/server/ffmpeg/renderer.ts:107-163`](../../../src/server/ffmpeg/renderer.ts) using `overlay=…:enable='between(t,a,b)'` anchored to `ResolvedPick.audio_start`/`audio_end`.

The V1 chat then narrows from 10 questions to ~4 (see "Questions for the technical chat" below).

## Why the other shapes lost

Pre-chat research returned **three killshots** and **two close-but-loses**. Hebrew/RTL viability and Adobe licensing are the dominant constraints.

| Shape | Verdict | Reason |
| --- | --- | --- |
| **aerender CLI** | **Killshot** | Requires full Adobe AE installation + paid CC licence on every editor's machine. "Render-only / non-royalty-bearing" mode is limited to network helper nodes supporting an artist who already owns AE. No Adobe SaaS-licence path off the shelf in 2025/2026. |
| **Skottie (via canvaskit-wasm)** | **Killshot for Hebrew** | Skia explicitly does not shape text; Skottie's text layer is glyph-per-codepoint with no HarfBuzz/bidi. Only viable if no runtime Hebrew text — which removes the whole point of dynamic overlays. |
| **rlottie** | **Killshot** | On life support — two tagged releases ever, no official Node bindings, you'd build mac+win binaries yourself. Same Hebrew-bidi gap. |
| **Lottie / Bodymovin** | **Close but loses** | Hebrew/RTL in `lottie-web` 5.x is still broken (open issue [airbnb/lottie-web#2541](https://github.com/airbnb/lottie-web/issues/2541), parallel [lottie-android#2279](https://github.com/airbnb/lottie-android/issues/2279)). Workable only with a strict designer-discipline pipeline: shapes + trim paths + Normal/Multiply only; no expressions, no feathered masks, no Trapcode; Hebrew text-to-shapes in AE; Fonts-mode Bodymovin export; per-job Hebrew labels pre-rasterized via node-canvas (HarfBuzz) and injected as Lottie image assets. Plus headless render requires either Puppeteer-driven lottie-web (stale, slow, Chromium bloat) or canvaskit-wasm (same Hebrew gap). **Only worth it if V1 has existing Lottie assets we must preserve.** |
| **Remotion** | **Close but loses on cost** | Chromium-backed = perfect Hebrew HarfBuzz/bidi. Right-sized as an overlay renderer (render to ProRes 4444 → ffmpeg overlay). Licence is `$25/seat/mo` (or `$0.01/render, $100/mo min`) for studios with >3 employees. Better long-term substrate than Bodymovin if budget allows. **Promote to v2 path if V1 is willing to re-author designs as React.** |
| **Pre-rendered ProRes 4444 + resvg-js SVG** _(recommended)_ | **Win** | No new runtime, no Adobe licence, no Hebrew compromise. Reuses the entire existing ffmpeg pipeline. ~3-5 days to v1 prototype. |

### Decision matrix (filled)

| Dimension | Lottie | aerender | **Pre-rendered + resvg** | Skottie | Remotion |
| --- | --- | --- | --- | --- | --- |
| Matches V1 source format? | needs chat (Q1) | needs chat (Q1) | yes — designer exports from AE | needs chat (Q1) | needs chat — V1 must re-author |
| Per-job dynamic Hebrew? | needs pre-raster hack | yes | **yes — resvg-js + rustybuzz** | no | yes |
| Needs AE installed at render? | no | **yes — killshot** | no | no | no |
| Bundles into Electron? | yes (with Chromium / WASM bloat) | no | **yes — no new binary** | yes (canvaskit ~6 MB WASM) | partial — Chromium bundle |
| RTL / Hebrew safe? | broken (issue #2541) | yes (designer responsibility) | **yes — rustybuzz** | no (Skia doesn't shape) | yes (Chromium) |
| Per-seat / SaaS cost? | free | per-machine AE licence | **free** | free | $25/seat/mo for >3 employees |
| Effort estimate | ~10–14 days w/ all constraints | n/a | **~3–5 days** | n/a (killshot) | ~7–10 days |

## Hebrew RTL state of the art (per engine)

RTL only matters if text is rendered *at render time*. For designer-baked text (shapes from text), every shape is RTL-safe because the bidi/shaping happened in AE. The constraint is which engines can shape Hebrew correctly at runtime:

| Engine | Hebrew RTL at runtime | Notes |
| --- | --- | --- |
| `lottie-web` 5.x | **Broken** | [airbnb/lottie-web#2541](https://github.com/airbnb/lottie-web/issues/2541). Logical-order code-point iteration, no bidi pass. Block shifts left, right-align dropped. |
| Skia / Skottie / canvaskit-wasm | **No** | Skia explicitly does not shape text ([Skia tips & FAQ](https://skia.org/docs/user/tips/)). Skottie's text layer is glyph-per-codepoint. |
| rlottie | **No** | No bidi pass. Same root issue as Skottie. |
| ffmpeg `drawtext` (native) | **Unreliable** | Needs `--enable-libfreetype --enable-libharfbuzz --enable-libfribidi`. Even compiled correctly, no proper UAX #9 paragraph bidi; mixed Hebrew + Latin + digits on one line breaks. |
| `ffmpeg-static` npm v6.1.1 | **Cross-platform broken** | Ships HarfBuzz/FriBidi only on the **Windows** binary, not macOS/Linux. Silent platform divergence. Verify with `ffmpeg -buildconf`. |
| **`@resvg/resvg-js`** | **Yes** | Rust `resvg` + `rustybuzz` (HarfBuzz port). Full bidi + shaping. Mixed-script lines render correctly. Deterministic across platforms. |
| node-canvas (Cairo + Pango + HarfBuzz) | Yes | Mature fallback if resvg-js ever falls short; heavier native build. |
| Chromium (Remotion, Puppeteer) | Yes | Full HarfBuzz/bidi via the browser engine. |

**Decision:** `@resvg/resvg-js` is the runtime text-shaping engine. It handles Hebrew correctly, ships prebuilt for all our platforms, and has no native build step. ffmpeg only composites the resulting PNG — it never touches text.

## Renderer extension surface

The existing ffmpeg pipeline already has clear extension points. Overlay-on-top is a localised patch.

| Concern | Existing file | Reuse / pattern |
| --- | --- | --- |
| Append new `-i` inputs for overlay MOV / PNG | [`src/server/ffmpeg/renderer.ts:84-104`](../../../src/server/ffmpeg/renderer.ts) | Same args-array push pattern used for audio + bg music inputs. |
| Insert `overlay=` filter chain | [`src/server/ffmpeg/renderer.ts:107-163`](../../../src/server/ffmpeg/renderer.ts) | Chain after `[vconcat]` / `[vout]`; output map unchanged. |
| Time-anchor overlay appear/disappear | [`src/server/ffmpeg/timeline-clip-timing.ts:17-30`](../../../src/server/ffmpeg/timeline-clip-timing.ts) | Reuse `narrativeDecodeFromPick()` outputs (`audio_start`, `audio_end`) per `ResolvedPick`. |
| Resolve bundled binaries (ffmpeg, future Skottie/etc.) | [`src/server/ffmpeg/binaries.ts:18-40`](../../../src/server/ffmpeg/binaries.ts) | Env-var → `which` fallback. Same pattern would resolve a bundled Skottie binary if we ever added one. |
| Subprocess + cancellation + stderr capture | [`src/server/ffmpeg/spawn.ts:32-105`](../../../src/server/ffmpeg/spawn.ts) | jobId-keyed, stderr ring buffer. Reusable for any headless renderer. |
| Feature-flag block | [`src/server/runtime/config.ts:91-100`](../../../src/server/runtime/config.ts) | Mirror the existing `r2: {…}` block. |

### Filter-graph sketch

Drops in after the existing concat stage at `renderer.ts:107-163`.

```ts
// Input section (append after existing clip + audio inputs, ~renderer.ts:104):
for (const overlay of overlays) {
  args.push("-i", overlay.path); // ProRes 4444 MOV or one-frame PNG from resvg-js
}

// Filter graph extension (chain after existing [vconcat] / [vout], ~renderer.ts:130):
//   [vconcat]                            ← existing concat output
//   [N:v] setpts=PTS-STARTPTS,format=yuva444p10le  [ov0]   ← per overlay
//   [vconcat][ov0] overlay=x=...:y=...:enable='between(t,1.0,4.5)'  [t1]
//   [t1][ov1]     overlay=...:enable='between(t,5.0,8.0)'           [vout]
//
// Notes:
//   - Apply setpts on the OVERLAY input, not on [vconcat] (post-concat PTS already starts at 0).
//   - Mid-chain: do NOT use format=auto (strips alpha). Final overlay can.
//   - Add :eof_action=pass when overlay duration < window.

// Output map unchanged: -map [vout] -map [aout]
```

For per-job dynamic Hebrew, generate the SVG → PNG before invoking ffmpeg:

```ts
import { Resvg } from "@resvg/resvg-js";

const svg = renderTemplate("lower-third", { city: scene.title_he, temp: "23°" });
const png = new Resvg(svg, {
  fontDirs: [path.join(process.resourcesPath, "fonts")], // bundled Heebo/Assistant/Rubik
  background: "rgba(0,0,0,0)",
}).render().asPng();
await fs.writeFile(overlayPngPath, png);
```

## Architecture impact (small)

- **New module:** `src/server/graphics/` — `overlay-plan.ts` (build overlay list from `PlanBundle.scenes`), `svg-text.ts` (resvg-js wrapper + template registry), `ffmpeg-overlays.ts` (filter-graph fragment generator).
- **Renderer extension:** localised patch to `src/server/ffmpeg/renderer.ts:84-163` — append overlay `-i` inputs + chain `overlay=` nodes; map unchanged.
- **Feature flag:** new entry in `src/server/runtime/config.ts:91-100` shape (mirrors `r2:`):
  ```ts
  graphics: {
    enabled: process.env.GRAPHICS_ENABLED === "1",
    assetsDir:    resolveFrom(projectRoot, process.env.GRAPHICS_ASSETS_DIR),
    templatesDir: resolveFrom(projectRoot, process.env.GRAPHICS_TEMPLATES_DIR),
  }
  ```
- **New runtime asset dirs:** `runtime/workspace/overlays/` (designer-provided ProRes 4444 MOVs) and `runtime/workspace/overlay-templates/` (SVG templates the app fills with scene data).
- **New npm dep:** `@resvg/resvg-js` (no other native dep needed; existing `ffmpeg-static` does the composite). Bundle Hebrew fonts (Heebo / Assistant / Rubik `.ttf`) in `electron/extraResources`.
- **No new binaries to ship** — resvg-js is napi-rs prebuilt; ffmpeg-static already shipped.

## Data Wiring

Dynamic graphics need values like temperature, city, date, and scene title. These already exist in the plan bundle:

- `scenes[].title_he`, `scenes[].keywords`, `scenes[].mood` ([`src/shared/types.ts:131-142`](../../../src/shared/types.ts)).
- `transcript_segments[].text` and timings ([`src/shared/types.ts:112-118`](../../../src/shared/types.ts)) — useful for animated subtitle/caption overlays.
- `ResolvedPick.audio_start` / `audio_end` ([`src/shared/types.ts:164-170`](../../../src/shared/types.ts)) — natural anchor for an overlay's appear/disappear.
- Job-level `created_at`, `duration_sec` ([`src/shared/types.ts:230-244`](../../../src/shared/types.ts)).

**Numeric weather data** (temperature, "feels like", wind, …) is **not** currently in the plan bundle. If V1's graphics need it, either (a) extract it from the narration text via an LLM pass, or (b) accept a structured weather-data input alongside the audio MP3. See question Q3 below.

## Cross-task bridge — AE comp as single source of truth (MOGRT + ProRes dual export)

Follow-up research into AE↔Premiere graphics interchange (Dynamic Link, MOGRT, Replace-with-AE, file handoff) surfaced a small additive that ties this task to the sibling [Premiere export task](../premiere/PLAN.md):

- **Dynamic Link** (AE comp live-linked into a Premiere sequence) requires AE installed and version-matched on the editor's machine, and is single-workstation-bound. **Not viable for our file-handoff workflow.**
- **MOGRT (`.mogrt`)** is the **only** graphics-layer interchange format between AE and Premiere. Authored in AE's Essential Graphics Panel; rendered by Premiere via an embedded AE engine — **the editor does not need AE installed.** Cannot be referenced from FCP7 XML (it's `.prproj`-only), but Premiere ExtendScript exposes `sequence.importMGT(path, time, vTrack, aTrack)` so a tiny JSX helper can auto-place all the branded lower-thirds at scene timecodes with Hebrew titles filled in.
- **AE has no other graphics-layer file-handoff path** — everything else is Dynamic Link (live) or rendered video.

### What this implies for the AE-graphics task

**Each branded AE comp is exported twice from one master:**

1. **ProRes 4444 MOV with alpha** — consumed by the in-app ffmpeg renderer (this task).
2. **`.mogrt`** — bundled alongside the Premiere FCP7 XML so editors get the branded look in Premiere with one JSX run.

Avoids divergence between "what the app renders" and "what the editor's Premiere build looks like." V1's designer authors once; both outputs reuse the same comp. The Premiere doc covers the bundle side.

**Live risk:** Hebrew in MOGRTs is buggy (community-reported 2024+, Hebrew-with-punctuation mis-renders). If MOGRT Hebrew text doesn't pass QA, the `.mogrt` ships with generic shapes and the editor types the city manually in Premiere — the in-app renderer's Hebrew (via resvg-js) is unaffected.

## Questions for the technical chat (narrowed from 10 to 4)

Most of the original 10 questions are resolved by the recommendation. What remains:

1. **(was Q1, narrowed)** Can the V1 designer export branded intro/outro/lower-third backgrounds as **ProRes 4444 MOV with alpha** from AE's Render Queue? If no, fall back to PNG sequences (work fine but bloat the installer).
2. **(was Q2, narrowed)** What's the **actual list of overlay categories V1 uses** today? Intro card, outro card, lower-third with text, full-screen weather panel, animated weather icons, transitions? Needed to scope the SVG template library and the ProRes asset list.
3. **(was Q4)** Where does **numeric weather data** come from in V1? Upstream JSON we can also consume, or LLM-extracted from narration? Determines whether a temperature overlay is shippable in v1.
4. **(was Q9)** Are V1's **existing graphics RTL-safe** in their current AE form (Hebrew text, mirrored layouts, correct alignment)? If yes, we have layouts to mirror; if no, we're designing fresh.

The other six original questions are resolved:
- Q3 (dynamic-data injection) — answered by our resvg-js + SVG template approach; AE has no runtime role.
- Q5 (AE installed at render time) — answered: no. The in-app renderer never touches AE; the designer's machine is the only one with AE.
- Q6 (resolution / fps / colour space) — declared by our pipeline: 1080×1920, 30 fps, ffmpeg `yuv420p`. Designer matches.
- Q7 (licensing) — sidestepped by treating AE as a design tool whose output we consume.
- Q8 (source-of-truth) — useful for the JSX helper / MOGRT side but not blocking the in-app renderer.
- Q10 (re-author appetite) — only relevant if we ever promote Remotion to v2; not blocking v1.

## File / Path Plan (for the future implementation session)

- `src/server/graphics/` — new module:
  - `overlay-plan.ts` — build overlay list from `PlanBundle.scenes` + scene-anchored timing.
  - `svg-text.ts` — resvg-js wrapper + Mustache template registry + bundled-font resolver.
  - `ffmpeg-overlays.ts` — filter-graph fragment generator (input chain + `overlay=…:enable=…` builder).
- `src/server/ffmpeg/renderer.ts:84-163` — patched to consume the fragment generator.
- `src/server/runtime/config.ts` — add `graphics: { enabled, assetsDir, templatesDir }` block (mirror `r2:`).
- `electron/forge.config.cjs` — add Hebrew fonts under `extraResource`.
- `runtime/workspace/overlays/` — runtime location for designer-provided ProRes MOVs (gitignored).
- `runtime/workspace/overlay-templates/` — SVG Mustache templates (small, committable).
- `src/test/graphics/` — unit tests against `docs/fixtures/samples/forecast_fixture_demo_complete.plan.json`; visual snapshot tests for resvg-js output (deterministic).

## Milestones (future)

1. `src/server/graphics/` module skeleton + SVG template registry + resvg-js wrapper with one "city name" template; unit-tests against fixture plan bundle.
2. Renderer filter-graph extension; render one PNG overlay on the existing ffmpeg concat for a fixture forecast end-to-end.
3. Scene-anchored timing (overlay appears for scene N, disappears at N+1) + multi-overlay chaining.
4. Feature flag + Electron asset/font bundling + smoke test packaged build.
5. First ProRes 4444 intro/outro overlay from V1's designer integrated; Hebrew RTL visual QA on a real forecast.
6. **(if cross-task bridge greenlit)** AE→MOGRT export from the same master comps; ship MOGRT + `place-mogrts.jsx` helper in the Premiere export bundle (sibling task).

## Verification (for the future prototype, not this docs session)

- Sample plan bundle renders with the chosen graphic overlaid at the correct timing.
- Hebrew text renders RTL-correct in resvg-js output (snapshot test against committed reference PNG).
- `npx tsc --noEmit` and `npm test` pass.
- Electron packaged build on macOS + Windows produces the same overlay output as `npm run dev` (font bundling verified).
- `ffmpeg -buildconf` of the shipped `ffmpeg-static` is irrelevant since we never use `drawtext` — but document this so future maintainers don't reach for it.

## Non-Goals

- No graphic design work — V1's designer authors the comps.
- No designer-facing template editor in WeatherV1.
- No commitment to MOGRT/Premiere bridge until the v1 in-app overlays land; that's a follow-on bundled in the sibling Premiere export task.
- No AE installation on any user/editor machine.
- No Lottie/Skottie/Remotion runtime in v1.

## Primary research sources

- [airbnb/lottie supported AE features](https://github.com/airbnb/lottie/blob/master/after-effects.md)
- [airbnb/lottie-web#2541 — Hebrew text shift](https://github.com/airbnb/lottie-web/issues/2541)
- [Skia Tips & FAQ — Skia does not shape text](https://skia.org/docs/user/tips/)
- [Samsung/rlottie releases](https://github.com/Samsung/rlottie/releases)
- [Adobe — automated/network rendering](https://helpx.adobe.com/after-effects/using/automated-rendering-network-rendering.html)
- [Adobe community — aerender licensing](https://community.adobe.com/t5/after-effects-discussions/licensing-requirement-to-run-aerender-as-background-job/m-p/14337437)
- [Remotion License & Pricing](https://www.remotion.dev/docs/license)
- [Motion Canvas FFmpeg exporter](https://motioncanvas.io/docs/rendering/video/)
- [`@resvg/resvg-js` on npm](https://www.npmjs.com/package/@resvg/resvg-js)
- [Premiere ExtendScript — Sequence (importMGT)](https://ppro-scripting.docsforadobe.dev/sequence/sequence/)
- [Adobe community — Hebrew MOGRT bug](https://community.adobe.com/t5/premiere-pro-ideas/universal-text-engine-bug-hebrew-in-mogrts/idi-p/14866140)
