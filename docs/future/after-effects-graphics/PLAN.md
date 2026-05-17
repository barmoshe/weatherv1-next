# After Effects Graphic Layers — Discovery Plan

Companion to [TASK.md](TASK.md). This document is **discovery-shaped**: it surveys plausible integration shapes generically because the form of V1's AE assets is not yet known. The "Questions for the technical chat" section is the centrepiece — answering it unblocks the recommendation.

## Background

The current renderer (`src/server/ffmpeg/renderer.ts:39-177`) builds a filter graph that does only `trim → scale/crop → concat → audio mix` with no overlays, no drawtext, and no alpha compositing. Adding graphic layers will therefore take one of two architectural shapes:

1. **Overlay-on-top** — extend the existing ffmpeg filter graph at `src/server/ffmpeg/renderer.ts:107-163` with extra `-i` inputs for graphic streams (PNG sequences or MOVs with alpha) and append `overlay=` nodes after the per-clip scale/crop stage. Cheapest path; doesn't disturb the validated concat logic; ideal for lower-thirds and data overlays.
2. **Two-stage render** — produce the base concat first (today's output), then a second pass composites graphic layers on top with their own timing track derived from `scenes[]`. Cleaner separation of concerns; easier to gate behind a per-job feature flag; ideal for intro/outro cards and transitions that span scene boundaries.

Which pattern fits depends on what V1 hands off and how dynamic the graphics need to be.

## Plausible Integration Shapes (generic)

| Shape | What it is | Pros | Cons | Fits if V1's AE outputs… |
| --- | --- | --- | --- | --- |
| **Lottie JSON via Bodymovin** | Designer authors in AE, exports comps to Lottie JSON via the Bodymovin plugin; app renders frames via a Lottie engine (lottie-web, Skottie, rlottie, headless Node renderer) and either overlays PNG sequences via ffmpeg or composites in a browser/Skia layer. | Small files (JSON); parameterisable text + colours at runtime; no AE install needed at render time; large ecosystem. | Not every AE feature exports cleanly (effects, expressions, some blend modes); the renderer must match what the designer used. | …are already exported as `.json` Lottie files, or can be re-exported. |
| **aerender CLI on raw `.aep`** | App invokes Adobe's `aerender` against the original AE project to produce transparent MOV/PNG sequences per job, then composites via ffmpeg. | Pixel-perfect — uses real AE; supports every AE feature including paid plugins. | Requires AE installed on the render machine (kills desktop distribution); slow; per-render Adobe licensing concerns. | …are raw `.aep` files and rendering happens on a server we control. |
| **Pre-rendered transparent clips** | Designer pre-renders a fixed set of MOV (ProRes 4444) or PNG sequences with alpha; app composites them via `ffmpeg -i overlay.mov … overlay=…`. | Trivial; no AE runtime; works today; deterministic. | No per-job parameterisation (text/numbers baked in); designer must re-render for every variant. | …are stock branded openers/transitions that don't change per forecast. |
| **Skottie / rlottie sidecar** | Use Google's Skottie or Samsung's rlottie to render Lottie JSON to a PNG/MOV sequence in a child process, then overlay via ffmpeg. | Fast, headless, native binary; deterministic; bundles cleanly into Electron. | Same Lottie coverage gaps as above; another native binary to ship and code-sign. | …are Lottie JSON and we want a fast headless renderer inside Electron. |
| **Browser-side compositing (Remotion / Motion Canvas)** | Replace or augment the renderer with a React/Canvas engine that draws clips + graphics in HTML, then captures frames to video. | Web-native; designers can iterate in React; very flexible. | Major architectural shift; different mental model from AE; large new surface to maintain. | …we're willing to walk away from the AE authoring pipeline entirely. |
| **ExtendScript / scripted AE** | Drive AE itself with ExtendScript over a job queue, treating it as a render farm. | Full AE power, fully dynamic. | Heaviest infrastructure; AE per node; very far from local-first desktop. | …V1 already operates an AE render farm we can hook into. |

## Data Wiring

Whatever shape is chosen, dynamic graphics need values like temperature, city, date, and scene title. These already exist in the plan bundle:

- `scenes[].title_he`, `scenes[].keywords`, `scenes[].mood` (`src/shared/types.ts:131-142`).
- `transcript_segments[].text` and timings (`src/shared/types.ts:112-118`) — useful for animated subtitle/caption overlays.
- `ResolvedPick.audio_start` / `audio_end` (`src/shared/types.ts:164-170`) — tells you when each clip is on-screen, which is the natural anchor for an overlay's appear/disappear.
- Job-level `created_at`, `duration_sec` (`src/shared/types.ts:230-244`).

Numeric weather data (temperature, "feels like", wind, …) is **not** currently in the plan bundle. If V1's graphics need it, we would have to either (a) extract it from the narration text via an LLM pass, or (b) accept a structured weather-data input alongside the audio MP3. This is one of the questions below.

## Questions For The Technical Chat

Hand this list verbatim to whoever knows the V1 graphics stack. Answers populate the decision matrix.

1. What **file format** does V1 hand off for graphics today? `.aep`, Lottie JSON, pre-rendered alpha MOV, PNG sequences, something else?
2. Which **graphic categories** exist? (intro card, outro card, lower-thirds with temperature, full-screen weather panel, animated icons, ticker, transitions, …)
3. How does V1 inject **dynamic data** today — does it edit AE comps per render (ExtendScript / data-driven AE), use Lottie text replacement at runtime, or are graphics statically rendered?
4. Where does the **numeric weather data** come from in V1? Is there an upstream JSON we can also consume, or is it parsed out of the narration text?
5. Does V1 require Adobe After Effects to be **installed on the render machine**?
6. What **resolution / frame rate / colour space** do the AE comps target? Does it match WeatherV1's 1080×1920 / 30 fps assumption?
7. Are there **licensing constraints** on the AE projects, fonts, or plugin effects used (e.g., paid AE plugins like Trapcode)?
8. Is there an **existing source-of-truth** for the V1 graphics somewhere (repo, Drive folder, designer's machine)? Can we get read access?
9. Are the graphics **RTL-safe** (Hebrew text, mirrored layouts, correct alignment)?
10. Is there appetite to **re-author** graphics in a code-native format (Lottie, Remotion) if it makes integration cheaper, or is keeping the existing AE workflow non-negotiable?

## Decision Matrix (fill in after the chat)

| Dimension | Lottie | aerender | Pre-rendered | Skottie | Remotion |
| --- | --- | --- | --- | --- | --- |
| Matches V1 source format? | ? | ? | ? | ? | ? |
| Per-job dynamic data? | yes | yes | no | yes | yes |
| Needs AE installed? | no | yes | no | no | no |
| Bundles into Electron? | yes | no | yes | yes | partial |
| RTL / Hebrew safe? | needs check | yes | yes | needs check | yes |
| Effort estimate | ? | ? | ? | ? | ? |

## File / Path Plan (for a future implementation session)

Concrete paths depend on the chosen shape. Placeholders so the future session knows where to look:

- `src/server/graphics/` — new module for graphic-layer composition (engine-agnostic interface; pluggable backend per shape).
- Extensions to `src/server/ffmpeg/renderer.ts` if the chosen shape uses the overlay-on-top pattern.
- New schema fields in `PlanBundleSchema` (`src/shared/types.ts:230-244`) for graphic-layer parameters if a two-stage render is introduced.
- A new feature-flag entry in `src/server/runtime/config.ts` so graphics can be enabled per environment during the rollout.

## Milestones (future)

1. Conclude the technical chat; capture answers back into this PLAN under a new "What we learned" section.
2. Pick one shape from the matrix; archive the others as alternatives.
3. Prototype: render one chosen graphic (e.g., intro card) over a sample forecast end-to-end on a dev machine.
4. Wire data binding from the plan bundle into the prototype.
5. Integrate behind a feature flag in the renderer; ship to Electron.

## Verification (for the future prototype, not this docs session)

To be defined alongside the chosen shape. Minimum bar:

- Sample plan bundle renders with the chosen graphic overlaid at the correct timing.
- Hebrew text renders RTL-correct, font fallback handled.
- `npx tsc --noEmit` and `npm test` pass.
- Electron packaged build produces the same output as `npm run dev`.

## Non-Goals

- No graphic design work.
- No designer-facing template editor in WeatherV1.
- No commitment to a specific shape until the technical chat happens.
