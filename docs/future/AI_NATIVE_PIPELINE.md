# Vision: AI-native pipeline, multi-catalogue, and the product rename

> Status: vision / discovery. No code changes proposed in this doc — only the direction and the open questions to chew on before we entrench the current shape. Downstream of `CATALOG_TAGGING_REDESIGN.md`; not blocking it.

## Why this exists

The app today is single-domain (weather), runs a fixed chain of bespoke LLM calls glued together in TypeScript, and is named after its first use case. Each of those properties is a reasonable starting point. None of them is obviously the right place to *stay*. This doc captures four shifts we suspect we'll want a year from now, recorded together because they reinforce each other, and recorded early so foundational work in flight doesn't quietly foreclose them.

## Four intertwined shifts

- **From one catalogue to many parallel catalogues.** Weather is the first domain, not the only conceivable one — army readiness briefings, education explainers, and similar production patterns share the same pipeline shape with a different vocabulary.
- **From a fixed pipeline to an agent that orchestrates.** Today the stages run in a hard-coded order with hard-coded handoffs. Tomorrow the stages could be tools an agent calls in whatever order the job requires, with loops, re-plans, and re-picks as first-class moves rather than special cases.
- **From "call model, parse JSON" to "give model tools, let it work".** The codebase is shaped around consuming model outputs as typed data. A more AI-native shape gives models capabilities — search the catalogue, fetch a segment, re-segment a clip, render a preview, validate against the brief — and records what they did.
- **From "WeatherV1" to a general AI video portal.** The name describes the first use case. If the technical direction is multi-domain and agentic, the product positioning has to follow; otherwise the installer, splash, docs, and download page keep signalling "weather app" while the product no longer is one.

## Multi-catalogue, in one paragraph

Parallel domains, each its own world: its own clip library, its own taxonomy, its own editorial voice, its own notion of "obvious mismatch". One catalogue is active per job. Catalogues do not share clips or vocabularies. The pipeline shape underneath is the same one we already have.

## Agentic pipeline, in one paragraph

A planner-style agent owns the job from transcript to render, choosing when to plan, when to re-plan, when to search the catalogue, when to swap a pick, when to ask for help. The current linear stages become tools the agent calls. Determinism and observability stay first-class — the agent's trace replaces today's plan bundle as the artefact of record. Cost ceilings, time budgets, and "stop and confirm" boundaries are part of the agent's contract, not afterthoughts.

## AI-native vs. LLM-API, in one paragraph

Today a model returns a typed payload that imperative code interprets and branches on. Tomorrow a model invokes capabilities and the system records the call graph. The contract shifts from "what shape is the JSON" to "what tools exist and what are they allowed to do". The win is not fewer LLM calls — it is moving editorial judgement *into the model's loop* instead of trying to encode it in TypeScript around the model.

## Product framing, in one paragraph

A rename — working title **"V1 AI Portal"** — frames the app as a portal *into* AI-driven video production for any domain its operator brings, with weather as the inaugural catalogue rather than the whole product. The rename is a positioning shift, not a technical one: it does not require any of the engineering above to ship first, but it is the natural moment to do it, and doing it late means rewriting more surfaces. Surfaces that carry the current name include the installer filename, app and window title, splash and onboarding copy, docs, the GitHub repo, release artefacts, R2 download paths, and the public download page.

## What stays invariant across all four shifts

The local-first nature. The workspace + R2 sidecar model. The renderer-facing API contract. The desktop runtime guarantees (loopback ports, session-token auth, no remote URLs in ffmpeg, no permanent R2 keys on disk). The reproducibility of a finished job from its recorded artefacts.

## Best practices to draw on

Patterns and principles from public guidance (Anthropic's *Building effective agents*; industry agent-observability writing; general AI-engineering practice) worth importing rather than re-deriving:

**Pipeline shape**

- Start with the simplest workflow shape that meets the goal; only reach for an autonomous agent when a predefined chain genuinely cannot express the work. "Agentic" is not strictly better — it trades predictability for flexibility.
- Treat the named patterns as a vocabulary, not a hierarchy: prompt chaining, routing, parallelisation, orchestrator-workers, evaluator-optimizer, autonomous agent. Different stages of one job may want different patterns.
- Keep the *most expensive* and *least reversible* steps (render, large file moves, external publishes) behind explicit confirm gates, even if the rest of the pipeline is autonomous.

**Tool design**

- The leverage point in an agentic system is tool design, not prompt wording. Tools should have narrow surfaces, unambiguous names, descriptions written for a model reader, and stable contracts.
- Prefer fewer powerful tools over many overlapping ones; ambiguity between tools is where agents waste turns.
- Every tool returns enough context for the agent to recover from its own mistakes (what changed, what's still pending, what to try next) — not just success/failure.
- Side-effecting tools are idempotent or carry an operation ID, so retries are safe.

**Observability and evaluation**

- The agent's trace — every prompt, tool call, intermediate decision, and outcome — is a first-class artefact, not a debug log. It is what makes a non-deterministic pipeline auditable and replayable.
- Adopt an OpenTelemetry-style posture early: emit traces in a portable shape so the backend choice stays open.
- Run an evaluation suite that grows from real failure modes. The loop is: observability surfaces a failure → eval suite captures it as a case → prompt / tool / policy change prevents recurrence.
- Track cost and latency per job and per tool call as first-class metrics; agentic systems regress on cost silently.

**Domain knowledge as data, not code**

- Push domain-specific judgement out of imperative code and into artefacts the agent reads: a domain brief, a taxonomy, a rule pack, a few-shot bank. Code becomes domain-agnostic infrastructure; domain becomes editable content.
- Schema and prompt versions travel with the artefacts they describe, so re-runs across versions are comparable rather than confused.
- Prefer prompt caching for the large, slow-changing context (catalogue, brief, taxonomy) so per-job cost scales with the *job*, not the *world*.

**Calibrated autonomy**

- Stage autonomy in tiers: fully autonomous for low-risk reversible work; human-in-the-loop for irreversible or expensive work; advisory-only for anything brand-facing until the eval suite earns trust.
- Cap autonomy with hard budgets (tokens, wall time, tool-call count). An agent that runs forever is a defect, not a feature.

**Product rename continuity** (specific to the WeatherV1 → V1 AI Portal shift)

- Rebrands fail when old URLs, installer names, and update channels break. Plan for old artefacts to keep resolving — redirects, alias paths, dual-named release assets during the transition — before changing the visible name.
- Sequence the rename brand-first, code-last: positioning, docs, and download page can move ahead of the repo and the binary, which are the most disruptive to change.
- Decide up front whether "V1" is heritage to preserve or baggage to drop; mixed signalling ("V1" in some surfaces, dropped in others) is the worst outcome.

## Design tensions worth flagging now

- Agent autonomy vs. predictability of cost and runtime.
- Per-catalogue prompts vs. one domain brief the agent reads.
- Hard-coded validator rules vs. catalogue-supplied rule packs the agent consults.
- Tools the agent can call freely vs. tools that require human confirmation.
- Whether "agent" means one orchestrator or several specialists (planner / picker / critic) coordinating.
- Shared underlying assets (transitions, music, voiceover) vs. fully siloed catalogues.
- Whether a catalogue is a deploy-time choice, a workspace choice, or a per-job choice.
- Whether the rename should land before, alongside, or after the multi-catalogue work — and how to handle continuity for existing installs, R2 paths, and update channels.
- Whether "V1" stays in the new name (heritage / continuity) or gets dropped (clean break).

## Relationship to other future work

`CATALOG_TAGGING_REDESIGN.md` is the most upstream piece. It is the natural place to let the tag schema *travel with the catalogue* rather than live in source — a small framing change there keeps the multi-catalogue and agentic options open without committing to either. The `temporal/` research line is also relevant: an agentic pipeline that loops and re-plans benefits from a workflow engine underneath, and the questions raised there (durability, idempotency, observability) become more pressing once orchestration moves out of straight-line TypeScript.

## References

- Anthropic, *Building effective agents* — workflow-vs-agent distinction; the canonical pattern vocabulary (prompt chaining, routing, parallelisation, orchestrator-workers, evaluator-optimizer, autonomous agent); "start simple, escalate deliberately".
- Public 2026 writing on agentic observability and the Agent Development Lifecycle (Arthur, Coralogix, others) — OpenTelemetry-first traces; observe → evaluate → policy-update loop; staged autonomy and human-in-the-loop checkpoints.
- Google Cloud Architecture Center, *Choose your agentic AI architecture components* — matching architecture to use case; explicit cost and latency budgeting.

## Non-goals for this doc

No implementation plan. No new APIs, file paths, env vars, or framework choices. No final rename decision. No commitment to ship any of this. No multi-tenant SaaS framing — the single-tenant invariant stays. No claim that an agentic pipeline is strictly better than the current one; only that the choice is worth making deliberately rather than by default.

## Open questions

- Is there real demand beyond weather, or is multi-domain a thought experiment?
- Would a second catalogue be built in-house or onboarded by an outside editor?
- Is the right unit a "catalogue" or a "domain pack" (taxonomy + prompts + rules) layered over a generic clip library?
- Does an agentic core need a workflow engine underneath, and how does that interact with the existing `temporal/` research?
- What does evaluation look like when the pipeline is non-deterministic?
- What's the actual new product name — "V1 AI Portal", "AI Video Portal V1", something else — and who decides?
