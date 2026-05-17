# Research: Catalog tagging redesign

> Status: research / design proposal. No code changes proposed in this doc — only the questions, evidence, and approaches to evaluate before redesigning the tagging pipeline.

## Why this exists

The picker + validator pipeline depends on per-segment catalog metadata to choose visuals. Quality analyses across recent jobs (`5da2cb6a…`, `8a7445b7…`, `a56bbdaa…`, `7943c8d5…`) show the dominant source of bad picks is **the catalog itself**, not the picker prompt or the validator's rule code. The validator's structural rules (anti-repeat, mood compatibility, weather polarity gates added in Phase C) can only filter what the tags allow them to see. With sparse or inconsistent tagging, the picker falls back to brittle heuristics and the validator falls back to "tag overlap ≥ 2" — which produced the famous snow-for-heat swap.

The current tagging pipeline lives under [`src/server/catalog/`](../../src/server/catalog/) + [`runtime/cache/tagging/`](../../runtime/cache/tagging/) (segment tag results JSON, partitioned into `segment-tag-results.part-N.json` shards). Tags come from a vision model pass — currently a flat English token list (e.g. `["snow", "day", "winter", "cold", "urban", "nature", "north", "gloomy"]`) plus a short Hebrew description.

## Observed failure modes (concrete)

These are real picks pulled from R2 plans in the last few jobs:

| # | Failure | Why it happened | Tag-level evidence |
| --- | --- | --- | --- |
| 1 | Snow clip selected for heat-wave scene | `targetContradictsSegment` matches text containment, but the snow segment's tags are English-only (`snow, winter, cold`). Hebrew narration `גל החום` looks for Hebrew `שלג` — only matches via the segment description. When the description doesn't lead with "שלג", the gate misses. | `W020-s1` tags `["snow", "day", "winter", "cold", …]`, description starts with `שלג יורד` (matches), `concepts: null` (no structured weather field) |
| 2 | Glamour sunset over Eilat hotels chosen for "clear weekday morning" | Tag `clear_sky` matches "clear" intent. There's no signal that this is `sunset/dusk` aerial glamour vs. a midday clear shot. | `IB145-s2` tags include `clear_sky, day, aerial, sea, eilat, south` — `day` is generic, no `golden_hour` flag |
| 3 | Same clip (`IB109`) picked 3× across a heatwave forecast | The catalog has only one "vineyard under bright sky" cluster matching `heat + summer + bright`. The picker exhausts unique heat clips after 1-2 picks. | Catalog has ~408 segments but heat-class segments cluster on ~3 source files |
| 4 | "Snow segment swapped in via tag overlap=2" | Validator falls back to any clip sharing 2+ tags with the rejected one when no perfect match exists. Tags like `urban + winter` overlap snow and heatwave shots. | `IB109` → `W020` swap on `urban + winter` overlap, ignoring weather polarity (Phase C fixes the polarity check at the code level; the catalog still under-covers cold/wet/heat variety) |
| 5 | False-positive "thematic adjacency: ים ושקיעה run_length=9" | All 9 picks share a "sea/sunset" thematic-tag bucket even though only 1 is actually sunset. Suggests the catalog's higher-level grouping carries the tag too widely. | Affects every plan we've inspected |
| 6 | "Deer in a park" picked for "cold across the country" | The picker keyword-matched `winter+overcast+park` and the description "צבאים רועים" was deemed thematically neutral. Tag set says nothing about what the SUBJECT is. | `IB072-s11` tags `[overcast, urban, nature, day, winter, center, gloomy]` — nothing flags the subject as wildlife (off-topic for a weather forecast) |

Underlying patterns:

- **Tag language inconsistency.** Tags are English; narration is Hebrew; the structured `concepts` field is half-populated. Two languages, three vocabularies (tags / concepts / Hebrew description), all describing the same thing inconsistently.
- **Tags describe *what's visible* without distinguishing primary vs. background.** A frame with a heat-shimmer foreground and an out-of-focus cloud gets tagged with both — the picker can't tell which dominates.
- **No subject taxonomy.** "Deer" and "Bedouin tents" carry no flag that they are off-topic for weather B-roll.
- **No editorial intent / role taxonomy.** "Opening shot", "transition", "explainer overlay-friendly", "drone establisher" — all collapsed into generic `aerial` or `urban`.
- **No polarity/lifecycle metadata.** A clip showing weather *transitioning from rain to clear* is tagged with both `rain` and `clear_sky`. The picker can't tell which moment in the narration arc it serves.
- **No quality / brand metadata.** "Vertical-friendly", "talent-on-camera", "lower-third safe area free" — none of these exist.

## Goals

1. Make the tag schema **rich enough that the picker prompt can disambiguate without prose reasoning**. Today the prompt does ~5 layers of Hebrew rules trying to compensate for tag sparsity. Move that judgment into the catalog.
2. Make the tag vocabulary **deterministic and Hebrew-canonical**. One language. Closed enumerations for axes the picker needs to filter by (weather, time-of-day, subject, role). Free-text reserved for description only.
3. Make tagging **incremental and re-runnable**. Today the tagging script runs as a one-shot batch. A re-tag should be cheap: detect stale segments, re-process only those, preserve human overrides.
4. Make tagging **auditable**. Every segment carries `tagged_by`, `tagged_at`, `model_version`, `prompt_version`, `human_overrides` so we can replay or migrate.
5. Make tagging **comparable across runs**. Different vision models on the same clip should converge — or the divergence should be visible and reviewable.

## Research questions

These are the open questions that have to be resolved before redesigning. Some have obvious answers; others need real data.

### A. Schema

- A1. **Which axes** should be closed enumerations vs. free-form? Candidate axes: `weather`, `time_of_day`, `season`, `region`, `subject_primary`, `subject_secondary`, `role`, `mood`, `polarity` (incoming/ongoing/ending state), `composition` (e.g. wide/closeup, vertical-safe), `quality_flags` (e.g. has-watermark, has-talent).
- A2. **Granularity.** "weather: שרב" vs "weather: עומס חום" — same or different? Define a controlled vocabulary with hierarchical relations (שרב is-a עומס חום is-a חם).
- A3. **Polarity / lifecycle.** When narration says `גל החום מסתיים`, we need clips that depict the **new** state (calm). Today no segment tells us "this clip shows X *ending*". Should polarity be a separate axis, or part of `role`?
- A4. **Multi-region clips.** Some clips span two regions geographically. Should `region` be an array or a primary+secondary pair? Affects heterogeneous-scene matching.

### B. Languages and canonical form

- B1. Tag in **Hebrew only**? English-only? Both?
   - Recommendation lean: Hebrew canonical (matches narration), English as alias map for legacy tags so we never lose old data.
- B2. How do we handle **descriptions that contradict tags**? E.g. tag `clear_sky` but description mentions clouds. Pick a tie-breaker rule and enforce in tagging output.

### C. Tagging pipeline

- C1. **Vision model**: continue with Gemini? Try Claude vision? GPT-4o vision? Benchmark on a fixed 50-clip eval set scored against human ground truth.
- C2. **Single-pass vs multi-pass**. Single pass = one prompt yields full schema. Multi-pass = separate prompts for weather, subject, composition, etc. — possibly cheaper to iterate but more requests per clip.
- C3. **Prompt structure**. Should the tagging prompt be schema-driven (model fills a JSON shape with allowed values per field, à la `buildPickResponseSchema` enum-locking) or freeform-then-normalize?
- C4. **Human override layer**. Where do human edits live? In `runtime/catalog.json` directly? A side-car `runtime/catalog.overrides.json`? Inline `human_overrides: {...}` per segment?
- C5. **Re-tag triggers**. New model version → re-tag everything? Or only segments whose `model_version` is below threshold? Or never auto, always manual?
- C6. **Tagging confidence**. Should every field carry a confidence score so the picker can prefer high-confidence tags?

### D. Catalog quality control

- D1. **Coverage analysis tooling.** Today we don't know we're short on `heat+drone+non-vineyard` clips until a heat-wave forecast renders three identical shots. Build a coverage report: per-axis distribution, gap detector against a target distribution.
- D2. **Per-axis redundancy.** Is `IB109-s0`, `IB109-s1`, `IB109-s3` truly different shots, or near-duplicates? Add a perceptual-hash diff so we don't tag obvious dupes as distinct.
- D3. **Bad clip flagging.** Some clips have watermarks, glitches, or weak production value. Flag them so the picker can avoid unless desperate.

### E. Concrete migration

- E1. **Backwards-compat.** Existing tagged segments must keep working through one or two release cycles. Define alias maps from legacy → new schema. Where do they live?
- E2. **Re-tag cost.** Tagging 400+ segments through a vision API is non-trivial. Estimate cost per model, decide which segments must re-tag now vs. lazy-on-touch.
- E3. **Schema migration order.** Probably: (1) ship the new schema in code with optional fields, (2) re-tag, (3) cut over the picker/validator to require new fields, (4) deprecate legacy aliases. Each step shippable independently.

## Candidate approaches

A non-exhaustive sketch of what the redesign might look like, to be eliminated/refined by the research above.

### Approach 1: Hierarchical Hebrew schema, single vision pass

Schema fields, all enumerated:

```json
{
  "weather": ["שרב"],
  "weather_polarity": "ongoing",          // ongoing|incoming|ending
  "time_of_day": "צהריים",
  "season_visible": "קיצי",
  "region": ["מרכז"],                     // 0..N
  "subject_primary": "כרם",                // closed list of weather-relevant subjects
  "subject_avoid": ["חיה"],                // explicit off-topic markers
  "composition": ["צילום רחפן", "אופקי"],
  "mood": "calm",
  "role": ["רקע כללי", "פתיחה"],
  "quality_flags": [],                     // e.g. ["watermark"]
  "confidence": { "weather": 0.92, "subject_primary": 0.78, … }
}
```

Pros: schema-driven prompt is reliable; the picker can filter mechanically. Cons: vocabulary explosion; needs maintenance.

### Approach 2: Embeddings-first, tags as cache

Replace categorical tags with a per-segment embedding of (Hebrew description + visual features). The picker scores candidates by embedding similarity to the scene narration (Hebrew). Cache the resulting top-K nearest-neighbors as "tags" for the validator/UI.

Pros: no taxonomy maintenance; multilingual handled natively. Cons: opaque, hard to debug a wrong pick; embedding drift across model versions; requires vector store.

### Approach 3: Two-tier (structured fields + embedding fallback)

Structured fields for hard filters (weather polarity, region, subject_avoid) — small closed enumerations only. Embeddings for soft ranking after filtering. Best of both, more moving parts.

### Approach 4: Just better prompts to current pipeline

Don't redesign; rewrite the existing tagging prompt to be schema-driven and re-run. Cheapest path; doesn't address subject/polarity gaps unless the prompt asks for them.

## Success criteria

A redesign is successful when, on a held-out eval set of ~10 representative forecasts:

1. **Zero categorical weather mismatches.** No snow-for-heat, no calm-for-storm.
2. **No same-clip reuse on a 6+ scene plan** when the catalog has ≥3 same-weather alternatives.
3. **Sunset/dusk clips only picked for scenes whose narration mentions evening or geography known for sunset establishers** (אילת, חוף, ערב).
4. **No subject mismatches** (no animals, no people-as-subject for non-clothing scenes, no off-topic landmarks).
5. **Validator `quality: "ship"`** for ≥80% of plans, with the failures correctly flagged as `review`/`replan` not silent.
6. **`picker_reason` is always editorial Hebrew** (never `"validator: ..."`).
7. **A new tagging run on the existing catalog completes** within X minutes / Y dollars (target to be set).

## Open questions for the team

- Q1. Are we OK requiring all narration + UI text to remain Hebrew (so tags can be Hebrew canonical), or do we need a route that surfaces English tags somewhere (e.g. translator handoff)?
- Q2. Is there budget for a human in-the-loop tagging review pass on the existing 408 segments?
- Q3. What's the catalog growth rate? If we're adding 100 clips a month, the schema needs to be cheap to extend. If it's stable, we can over-design.
- Q4. Should `quality_flags` (watermark, talent-on-camera, etc.) be visible in the UI when a user manually picks via "אשר בחירה" so they know what they're committing to?

## Suggested next step

1. Pick the eval set (~10 forecasts spanning all weather modes — heat, cold, rain, transition, multi-region) and capture a current-state baseline: timeline, validator output, manual quality score per pick.
2. Build the coverage report (D1) against today's catalog. Quantify the gap.
3. Decide between Approaches 1/3 based on cost + eval results from a 50-clip pilot re-tag.
4. Promote this doc into an implementation plan (move into `docs/`) once the approach is chosen.

## References in this repo

- [src/server/catalog/hebrew-taxonomy.ts](../../src/server/catalog/hebrew-taxonomy.ts) — current schema + `targetContradictsSegment` + `weatherClassMismatch` (Phase C gate).
- [src/server/catalog/parser.ts](../../src/server/catalog/parser.ts) — how the picker consumes the catalog.
- [src/server/pipeline/validator.ts](../../src/server/pipeline/validator.ts) — swap heuristics that depend on tag completeness.
- [src/server/pipeline/picker.ts](../../src/server/pipeline/picker.ts) — picker prompt that compensates for tag sparsity.
- [runtime/cache/tagging/](../../runtime/cache/tagging/) — current tagging output shards.
- [runtime/cache/tagging/catalog-retag-proposals.json](../../runtime/cache/tagging/catalog-retag-proposals.json) — prior retag attempt artefacts.
