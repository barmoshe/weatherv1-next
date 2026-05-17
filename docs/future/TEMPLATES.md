# Vision: Templates as the unit of choice

> Status: vision / discovery. No code changes proposed in this doc — only the framing and the open questions to chew on before we entrench the current shape. Sibling doc: [`AI_NATIVE_PIPELINE.md`](AI_NATIVE_PIPELINE.md) (agentic pipeline + product rename). Downstream of [`CATALOG_TAGGING_REDESIGN.md`](CATALOG_TAGGING_REDESIGN.md); not blocking it.

## Why this exists

The app is single-purpose today: it produces Hebrew weather forecasts. The pipeline shape underneath, though, is not weather-specific — transcribe narration, plan scenes, pick visuals from a curated library, validate, render. The same shape would serve army readiness briefings, education explainers, and similar short-form narrated video work. This doc records the idea that the product's unit of choice could be a **template** — a self-contained production preset the user picks at the start of a job — with WeatherV1 as the inaugural template rather than the whole app.

## The concept, in one paragraph

A *template* is the unit of choice a user makes at the start of a job: "I want to produce a weather forecast", "I want to produce a readiness brief", "I want to produce an explainer". Each template bundles everything that makes *that kind of video* what it is — its clip catalogue, its taxonomy, the editorial voice of its prompts, its validator's notion of "obvious mismatch", its output aspect and length conventions, and its surface branding. Only one template is active per job. Templates do not share clips or vocabularies, but they do share the generic pipeline, the runtime, and (if the agentic-pipeline direction lands) the agent that orchestrates them. **WeatherV1 is the inaugural / reference template** — the one whose existence proves the shape and against which new templates can be benchmarked.

## What a template plausibly contains

Listed as a sketch, not a contract:

- **Catalogue.** The clip library for this domain — segments, tags, concepts, posters. No clip belongs to two templates.
- **Taxonomy.** The vocabulary the catalogue is tagged with: closed enumerations for the axes the picker needs to filter on (weather, time-of-day, subject, role, mood, …), free text where it doesn't.
- **Editorial brief.** The natural-language description of what this kind of video *is* — pacing, tone, what counts as a good pick, what's off-topic. This is what the model reads instead of a TypeScript rule.
- **Prompts.** Planner, picker, validator (or, in the agentic future, the single brief the orchestrator reads).
- **Validator rules.** The hard "obvious mismatch" checks specific to this domain (weather classes, polarity, time-of-day cues for weather; presumably very different axes for a briefing or explainer).
- **Output conventions.** Aspect ratio, target length, music style, voice, intro/outro graphics.
- **Brand surface.** Name, splash, on-screen lower-thirds, any template-specific theming.

How fat that bundle is allowed to be — pure data vs. data + code — is itself an open question (below).

## What WeatherV1 being "the reference template" means

- It is the template against which the platform's generic pipeline is benchmarked: anything the generic pipeline does should at least keep working for WeatherV1.
- It is the template new ones can be modelled on: when someone wants to define a "readiness brief" template, the working example to study is WeatherV1.
- It is the template that gets the most attention to depth (rich taxonomy, polished prompts, validator rules earned from real failure modes) — partly because it shipped first, partly because depth there is what proves the templates concept is real and not vapourware.
- It is *not* a privileged template at runtime. The pipeline treats it the same as any other.

## Why this is worth recording now

- A lot of foundational work in flight (tagging redesign, validator hardening, picker prompts) will entrench *weather-shaped* assumptions in source unless we keep the option open to let those assumptions travel with a template instead.
- Once a tag schema, prompt, or rule lives in source, lifting it into a template later is mechanically annoying. Lifting it from the catalogue artefact into a template-shaped artefact is much cheaper.
- This doc is not asking that work to *do* anything different — only to avoid foreclosing the option.

## Design tensions worth flagging now

- **How fat a template is.** Just data (catalogue + taxonomy + brief), or also code (custom tools, custom validators, custom output pipeline). The fatter, the more powerful and the harder to onboard a new one.
- **Sharing across templates.** Are transitions, music, voiceover, intro/outro graphics, the agent loop, and the eval harness shared infrastructure — or does every template ship its own?
- **Lifecycle of a template.** Deploy-time (shipped in the installer), workspace-level (downloaded into a user's workspace), or per-job (picked at job start). These have very different distribution and update stories.
- **Discovery and onboarding.** Built-in gallery, marketplace, or just "drop a folder in the workspace". Each implies different trust and curation models.
- **Authorship.** Who can write a template? In-house only, partner editors with a defined contract, or any user. Affects validation, sandboxing, and the brief's expressive power.
- **Versioning and migration.** Templates evolve; jobs need to record which version they ran against so re-runs stay comparable.
- **Eval per template vs. shared eval suite.** A shared suite keeps the platform honest; per-template suites are the only way to measure editorial quality for each domain.

## Relationship to other future work

- [`AI_NATIVE_PIPELINE.md`](AI_NATIVE_PIPELINE.md) — sibling vision doc on the agentic pipeline and the "WeatherV1 → V1 AI Portal" rename. Templates are the *what the user picks*; that doc is *how the app runs the pick*. Each can be pursued independently, but together they reinforce each other (an agent that reads a template's brief is more flexible than one with the brief hard-coded).
- [`CATALOG_TAGGING_REDESIGN.md`](CATALOG_TAGGING_REDESIGN.md) — the most upstream piece. The natural place to let the tag schema *travel with the catalogue* rather than live in source. A small framing change there keeps the templates option open without committing to it.

## Non-goals for this doc

No implementation plan. No proposed file paths, env vars, or APIs. No definition of a template file format. No commitment that templates will ever ship. No multi-tenant SaaS framing — the single-tenant invariant stays. No claim that WeatherV1 must be rewritten to fit a generic template shape *before* the platform earns the right to host a second one.

## Open questions

- Is there real demand beyond weather, or is multi-template a thought experiment?
- Would a second template be built in-house or onboarded by an outside editor?
- What exactly is *in* a template, and is that line drawn the same way for every template, or per-template?
- How does a user discover, install, and switch between templates?
- How does a template version itself, and how do in-flight or historical jobs handle a template that has moved on?
- Is "template" even the right word, or does the product want a different vocabulary (preset, recipe, format, channel)?
