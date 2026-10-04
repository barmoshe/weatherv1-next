---
name: v1-forecast
description: Make the V1 vertical weather forecast video locally from one narration recording, using Keshet's catalog on this machine. Fixed CLI tools do the mechanical work; you do only the judgement steps (correct the transcript, plan scenes, pick clips, review frames). Triggers on "make the forecast video", "תחזית ל-V1", "run the forecast agent", a narration file for V1.
---

# V1 forecast, made locally by the agent

Input: one narration recording. Output: `final.mp4` (1080x1920, 30 fps, -14 LUFS) built only from
Keshet's catalog (`~/v1Drive/weather`, override with `WEATHER_WORKSPACE_DIR`).

## Hard rules

- **Never write ffmpeg by hand.** Every render step is a tool below. If a tool can't do it, stop and say so.
- **Never guess a word.** A word you can't recover with confidence gets `"unresolved": true` in
  `transcript.fixed.json`, stays out of captions, and goes into `plan.unresolved` and the report.
- **Never use a clip outside the catalog**, and never copy catalog media into this repo (it is public).
- **The voice stays as recorded** (Bar's rule): no EQ, compression or edits; only the music mix and one
  master pass (`compose` does exactly that).
- **Never guess the date.** `date_label` is `null` unless the recording or the editor states it.
- A validation error you can't fix in **two** tries: stop and ask.
- At most **two** review-and-fix rounds after the first full render.

## The run

Job folders live outside the repo: `~/v1-agent-jobs/<yyyy-mm-dd>-<slug>/`, with the recording copied in
as `narration.mp3` (or .m4a/.wav). All commands run from the repo root:

```bash
npx tsx agent/cli.ts doctor                      # once per machine
npx tsx agent/cli.ts transcribe <job>            # -> transcript.json (local Whisper, word timestamps)
```

1. **Fix the transcript** → `transcript.fixed.json` (`{ text, words: [{ w, start, end, unresolved? }] }`).
   Correct by meaning (place names, numbers, clothing, weather terms); keep Whisper's timings. You may
   merge two tokens that are one word (`מעט צפון` → `מהצפון`, keep the first start and the last end).
2. **Write `plan.json`** (schema: `agent/lib/schema.ts`). Scenes tile the timeline with no gaps:
   first starts at 0, last ends at `duration` = narration length + `tail` (outro, default 3 s).
   Every `at` / `*_at` cue and every caption start is an exact word start from the fixed transcript.
   Scene types: `intro` · `text` (generic fallback) · `alert` · `trend` · `sea` · `clothing` ·
   `cities` · `event` · `days` · `outro`. Captions: 2-4 words, ≤ 34 chars, hidden in `cities`.
   Each scene's `bg` says what the footage should show (Hebrew `query`, `keywords`, optional `mood`,
   `concepts`, `treatment`: `clean` | `dim` | `blur`; use `blur` under the cities map).
   Run `npx tsx agent/cli.ts plan-validate <job>` until it passes.
2b. **Align to the voice:** `npx tsx agent/cli.ts align <job>` force-aligns every word (Hebrew wav2vec2)
   and moves every plan time onto the real voice; `plan.whisper.json` keeps your Whisper-clock plan.
   Write the plan on Whisper times, align, then validate again. Re-run it after any plan edit (it
   always maps from `plan.whisper.json`, so edit **that** file once it exists).
3. **Pick footage.** For each scene: `npx tsx agent/cli.ts search <job> <scene-id>` prints a ranked
   shortlist and writes `search/<scene-id>.jpg`, a numbered contact sheet. **Look at the sheet** and pick
   by eye: the shot must match the weather actually spoken (no sun on a rain line, no beach on a coat
   line). Long scenes (> 9 s) take 2 picks. `picks.json`:
   `{ "scenes": { "<scene-id>": [{ "segment_id": "W003-s0", "in": 2.0? }] }, "cities": { "<city-key>": "<segment-id>" } }`.
   `cities` maps a place to a catalog still for its card; leave it empty unless most cities have one
   (the map layout is the fallback). Run `picks-validate` until it passes.
4. **Preview before the full render:** `render-bg <job>`, then `render-gfx <job> --at 1.2,9.8,...` (one
   moment per scene) and look at `qc/preview.jpg`. Fix overlaps, wrapping, unreadable text (raise the
   scene's `dim`), wrong icons.
5. **Render:** `render-gfx <job>` (all frames), `compose <job>`, `qc <job>`. Look at `qc/qc.jpg`; `qc.json`
   lists loudness, true peak, duration, the decoded audio length and black frames. `final-share.mp4`
   (3.3 Mbps, under 30 MB) is the copy to send; then **play it** and check cues against the voice.
6. **Report** in `<job>/report.md`: wall time per step, picks, unresolved words, QC result, anything
   you fixed in review and anything that should change in the tools.

## Gotchas

- `compose` mixes audio in its own pass to `mix.wav`, then muxes it: one pass with loudnorm and the
  video encode deadlocked ffmpeg 8.1 near the end (0% CPU, truncated file).
- Whisper on this Mac: system Python's NumPy 2.x breaks `whisper`. Use the venv `doctor` suggests and set
  `WEATHER_AGENT_PYTHON`.
- `search` ranks strictly by the app's retrieval score (the app itself tier-shuffles for its picker);
  if a shortlist looks wrong, sharpen `bg.keywords` with words that appear in catalog descriptions.
- The catalog has place footage for only a few cities (Jerusalem, Tel Aviv, Hermon, Dead Sea at the
  time of writing). Don't force a city card from an unrelated shot.
