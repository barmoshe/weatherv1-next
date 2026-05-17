# Future Task: After Effects Graphic Layers (Discovery)

## Goal

Bring V1's existing After Effects–authored graphic layer into the WeatherV1 (Next.js / Electron) app, so forecasts can render with the same branded overlays — titles, lower-thirds, intro/outro cards, animated weather glyphs — that the original V1 system uses.

## Why Now

The current renderer (`src/server/ffmpeg/renderer.ts`) emits a clean clip concat with voiceover only. There are no on-screen titles, no data overlays (temperatures, city names, dates), no branded opener or closer, and no animated weather icons. V1 reportedly already solved the design side of this in After Effects, so the win here is reuse rather than re-design.

## Status: Discovery

The form of V1's AE assets is **unknown**. They could be raw `.aep` projects, Lottie/Bodymovin JSON exports, pre-rendered alpha MOV/PNG sequences, ExtendScript-driven templates, or something custom. The user will speak with someone technical from the V1 team; this doc captures what to ask and what to record before any implementation work begins.

## Done Means (for the research, not the implementation)

- We know the **file format** V1 hands off (Lottie JSON? `.aep`? alpha PNG/MOV sequences? something else?).
- We know which **graphic categories** exist (lower-thirds, intro/outro cards, transitions, animated weather icons, ticker, …) and which ones are dynamic vs. static.
- We know how V1 injects **dynamic data** today (hard-coded per render? parameterised via JSON? ExtendScript template? data-driven AE?).
- We have a **recommended integration shape** for WeatherV1 with concrete file paths and a rough effort estimate.

## In Scope

- The rendering side — compositing AE-style graphics into the current ffmpeg pipeline, or adding a second pass that runs after it.
- The data wiring — how scene/plan-bundle data feeds graphic parameters (temperatures, city, date, scene title).
- Compatibility constraints: 1080×1920 9:16, Hebrew RTL, Electron desktop distribution.

## Out Of Scope

- Re-designing the graphics themselves.
- Building a designer-facing template editor inside WeatherV1.
- Replacing the ffmpeg renderer wholesale.
- The reverse direction — exporting WeatherV1 timelines to Premiere is the sibling task at [`../premiere/`](../premiere/).

## Open Questions

The full list lives in [PLAN.md](PLAN.md) under "Questions for the technical chat". It is meant to be handed verbatim to whoever knows the V1 graphics stack.

## Plan

See [PLAN.md](PLAN.md).
