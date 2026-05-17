# Vision: UX direction

> Status: vision / discovery, research-grounded. No screens proposed in this doc — only the experience-level shifts and the public-evidence patterns to lean on. Sibling docs: [`TEMPLATES.md`](TEMPLATES.md), [`AI_NATIVE_PIPELINE.md`](AI_NATIVE_PIPELINE.md), [`PRODUCT_DIRECTION.md`](PRODUCT_DIRECTION.md), [`QUALITY_AND_EVAL.md`](QUALITY_AND_EVAL.md), [`MODEL_STRATEGY.md`](MODEL_STRATEGY.md), [`DATA_AND_CONTENT.md`](DATA_AND_CONTENT.md), [`DISTRIBUTION.md`](DISTRIBUTION.md), [`ECOSYSTEM.md`](ECOSYSTEM.md), [`LOCALIZATION.md`](LOCALIZATION.md).

## Scope

This doc owns the **experience layer**: how the user picks a template, sees what the agent is doing, intervenes when it goes wrong, confirms before irreversible actions, and reads cost/time at a glance. It owns the mixed-direction *display* concern (RTL shell hosting LTR template content, or vice versa).

It does **not** cover: agent engineering ([`AI_NATIVE_PIPELINE.md`](AI_NATIVE_PIPELINE.md)), product positioning or pricing ([`PRODUCT_DIRECTION.md`](PRODUCT_DIRECTION.md)), the template concept ([`TEMPLATES.md`](TEMPLATES.md)), or per-locale *content* concerns ([`LOCALIZATION.md`](LOCALIZATION.md)).

## Why this exists

Today's UI is shaped around one job: produce a Hebrew weather forecast. The home screen is a workspace, the catalogue panel is *the* catalogue, the pipeline runs left-to-right with no real branching, and the user mostly watches. If templates become the unit of choice and the pipeline becomes agentic, the interface model has to evolve to match. This doc records the experience shifts to design for — early, while the cost of choosing is still low.

## The shape, in one paragraph

A user opens the app, sees the templates available to them, picks one (or resumes the last one used), and lands in a job space *shaped by that template*: its taxonomy in the filters, its brief on the side, its catalogue in the picker. Producing a video is a conversation with an agent that does most of the mechanical work — transcribing, planning, picking, validating — and shows its trace as it goes. The user steers at confirm gates, redirects when the agent goes wrong, and ships when satisfied. The same shell hosts every template; only the content inside it changes.

## Lean on the established AI/agent UX canons

Four canonical frameworks converge on the same UX primitives — disclose what the system is doing, scope its autonomy, support correction, degrade gracefully. The directly-actionable one is **Microsoft's HAX Guidelines for Human-AI Interaction** (18 guidelines across four phases: *initially / during interaction / when wrong / over time*). G1 "make clear what the system can do", G2 "what it can do how well", G8 "support efficient dismissal", G9 "support efficient correction", and G11 "make clear why the system did what it did" map almost one-to-one onto an agent UI's confirm-gate, replay, and trace surfaces ([Microsoft HAX Toolkit](https://www.microsoft.com/en-us/haxtoolkit/ai-guidelines/), [Guidelines for Human-AI Interaction (CHI 2019)](https://www.microsoft.com/en-us/research/publication/guidelines-for-human-ai-interaction/)).

Anchor the explainability and intervention chapters of the **Google PAIR People + AI Guidebook** ([Explainability + Trust](https://pair.withgoogle.com/chapter/explainability-trust/)) and **IBM Design for AI's Explainability** pillar — "a user should be able to ask why an AI is doing what it's doing on an ongoing basis" ([IBM — Explainability](https://www.ibm.com/design/ai/ethics/explainability/)). **Apple's HIG Generative AI** chapter is shorter but pointed: indicate AI involvement, surface limits, "provide straightforward ways for users to override or modify AI-generated recommendations" ([Apple HIG — Generative AI](https://developer.apple.com/design/human-interface-guidelines/generative-ai)).

These four canons are the floor, not the ceiling. The rest of this doc takes them as given.

## Agent trace: timeline of tool calls, collapsible reasoning

Mature agent products converge on **a timeline of tool calls plus collapsible reasoning**, not raw chain-of-thought. The strongest reference is GitHub Copilot Workspace, where "planning is explicit, stepwise, and artifact-oriented rather than opaque chain-of-thought" — the agent produces an editable spec, a per-file plan, then live-updating diffs you can edit in place ([Copilot Workspace manual](https://github.com/githubnext/copilot-workspace-user-manual/blob/main/overview.md)). Devin ships a four-tab workspace (Shell / Browser / Editor / Planner) with a scrubbable replay timeline at the bottom; chat auto-scrolls to match the replay cursor, so context and action stay coupled ([Devin product analysis](https://ppaolo.substack.com/p/in-depth-product-analysis-devin-cognition-labs)). Claude Code's observability is a chronological event view with token usage and per-tool-call detail ([Claude session tracing](https://platform.claude.com/docs/en/managed-agents/observability)).

The pattern translates as:

- **Shown by default** — current step, plan progress, the asset / scene / clip being touched right now.
- **Collapsible** — full reasoning, prompts, raw tool I/O.
- **Hidden** — system prompts, internal scaffolding.

For this app, the natural visible-by-default unit is **the scene** — the agent's "current scene", "scenes left", and "what just changed in this scene" are the producer's mental model already.

## Confirm gates: risk-tiered, batched, never per-action

Per-action confirmation is now widely treated as an anti-pattern: "confirmation fatigue is a threat vector, not UX friction" — habituated approvers wave through malicious or off-track actions buried in routine ones ([Changkun — Confirmation Fatigue](https://changkun.de/blog/ideas/human-in-the-loop-agents/), [Approval Fatigue Is an Agent Security Bug](https://www.developersdigest.tech/blog/approval-fatigue-agent-security-bug)).

The emerging consensus is **risk-tiered, batched approvals**: "one approval for five actions… the user sees exactly what will happen, can edit any step, and approves the entire sequence at once" ([Approval Fatigue pattern](https://aipatternbook.com/approval-fatigue)). For truly irreversible actions, the gold standard is **GitHub's "type the repository name" pattern**: case-sensitive text-entry gate, red Danger Zone visually segregated, button disabled until input matches ([GitHub destructive actions](https://www.golinuxcloud.com/github-delete-repository/)).

Translated to this app:

- **Free** — read-only ops: previews, transcript inspection, catalogue browsing.
- **Batch-approved with a cost preview** — render starts, batch re-tag operations.
- **Typed confirmation** — deleting a catalogue item, overwriting a published clip, irreversible R2 deletes.

Where each gate sits is a per-template editorial choice; the *shape* of the gate is platform infrastructure.

## Template picker: search-first, morph-on-select

Successful template-driven products bias toward **search-first home screens with morph-on-select previews**. Notion's first-run asks the user to pick templates by role and "dynamically updates the UI based on the user's selections, with the interface preview morphing in real-time" ([Candu — Notion onboarding](https://www.candu.ai/blog/how-notion-crafts-a-personalized-onboarding-experience-6-lessons-to-guide-new-users)). v0 Templates and Framer's onboarding panel feature a curated hand-picked row at top and a searchable grid below; Framer surfaces free community templates "to every user starting a new project" ([v0 Templates](https://v0.app/templates), [Framer onboarding panel](https://x.com/bynneh/status/1978777204466266606)).

Scaling 5 → 500: curated row stays small, the long tail goes behind tag filters + a prominent search box, and previews are large enough to be the decision artefact (don't make the user open a detail page to choose). Beyond 500 the surface becomes a marketplace, which is a different product question ([`PRODUCT_DIRECTION.md`](PRODUCT_DIRECTION.md)).

## Intervention and replay: interrupt, redirect, replay

Three primitives recur across mature agent products ([ClaudeLog — suspend Claude Code](https://claudelog.com/faqs/how-to-suspend-claude-code/), [Claude Code issue #29291 — pause and amend](https://github.com/anthropics/claude-code/issues/29291), [Auto-Claude #1642 — step-level control](https://github.com/AndyMik90/Auto-Claude/issues/1642)):

- **Interrupt** — Esc / Ctrl-C aborts mid-generation; Ctrl-Z suspends, `fg` resumes. Universal.
- **Redirect** — append context without restarting. Currently a top open request in Claude Code; not yet solved in any product.
- **Replay** — Devin's scrubbable timeline with read-only session records. Becoming standard.

Step-level *undo* is rare and mostly aspirational. For this app, the natural unit of "undo this step" is **per-scene replan** — closer to a notebook cell than a linear log. The user redrafts one scene without re-running the whole job.

## Onboarding shaped by the active template

When the app's behaviour varies per template, **onboarding belongs to the template, not the shell**. Notion's signup survey personalises the workspace by role and use case before showing the editor. VS Code's Walkthroughs API provides "a consistent experience for onboarding users to an extension via a multi-step checklist featuring rich content" — each language extension ships its own walkthrough rather than a global tour ([VS Code UX Guidelines](https://code.visualstudio.com/api/ux-guidelines/overview)). Framer ships an example project plus optional guided tour on first launch.

Pattern: the *picked template* owns the welcome checklist (which assets to gather, what the first job looks like, where the brief comes from); the global onboarding stays minimal — install, license, workspace dir. Adding a second template doesn't mean rewriting the global onboarding.

## Mixed-direction shells (RTL + LTR display)

W3C is explicit: use **logical ordering plus the Unicode Bidi Algorithm**, set `dir` on `<html>` for document direction, and only use `dir` on block elements where the *base direction* changes ([W3C — inline bidi markup](https://www.w3.org/International/articles/inline-bidi-markup/)). Material Design's bidirectionality guidance frames the rest: mirror layout, padding, directional icons; **do not** mirror numbers, URLs, or icons without direction semantics; time-sequence icons flip with reading direction ([Material 3 — bidirectionality](https://m3.material.io/foundations/layout/understanding-layout/bidirectionality-rtl)).

For a packages/templates model where each template may be Hebrew or English: set the *shell* to user-language, but set `dir` per-template on the content container — so a Hebrew template inside an English UI renders its text RTL while toolbars stay LTR. Per-locale *content* concerns (taxonomy, fonts, voice) live in [`LOCALIZATION.md`](LOCALIZATION.md); the *display* mechanics are this doc's.

## Visible cost as ambient telemetry, never a paywall

Successful patterns surface cost as **ambient telemetry**, not friction. Cursor's June 2025 shift to a credit-based pool drew negative reviews precisely because the meter felt opaque; Replit's "effort-based" per-action breakdown is generally read as more transparent ([Sidetool — Cursor vs Replit](https://www.sidetool.co/post/understanding-ai-pricing-cursor-vs-replit-what-s-the-difference/)). OpenAI's Realtime Playground shows token usage per session under a Logs tab next to the session id ([OpenAI Realtime costs](https://platform.openai.com/docs/guides/realtime-costs)).

Pattern for this app:

- **Estimated cost + time before** a render starts (as part of the confirm gate).
- **Running totals** while it runs.
- **Final actuals** in the job record.
- **A session / day rollup** somewhere ambient.

Never block the action behind cost UI; always let the user proceed with a single visible number. Pricing-model shape — who pays the bill, BYOK vs. credits — lives in [`PRODUCT_DIRECTION.md`](PRODUCT_DIRECTION.md).

## Design tensions worth flagging now

- **Floor vs. ceiling.** A first-time user wants the agent to "just produce something"; a power user wants every knob. The UI has to serve both without becoming two products.
- **Transparency vs. clutter.** Showing every tool call is honest but exhausting; showing only milestones is calm but opaque. The right grain is per-template.
- **Determinism cues.** Users expect "same input → same output". An agentic pipeline does not guarantee that. The UI must signal non-determinism honestly or constrain the agent enough to keep determinism.
- **Confirm-gate fatigue.** Too few gates → surprise renders, runaway cost. Too many gates → the agent isn't really doing anything for the user.
- **Template picker as homescreen.** Two templates: a list. Twenty: a gallery. Two hundred: a marketplace. Each implies a different shell.
- **RTL + LTR coexistence.** A Hebrew template inside a possibly-English shell. Mixed-direction shells are technically solved (W3C / Material) but break easily.
- **Continuity for existing users.** A Weather-only user's home suddenly becoming a template picker is disruption. Transition needs a default-template fallback so the change is opt-in for a while.
- **Where the trace UI lives.** Sidebar (always visible, takes width) vs. bottom panel (toggleable) vs. dedicated route (full-fidelity, less ambient).

## Open questions

- Is the template picker the home screen, a modal, or a "new job" affordance from inside a default template?
- How much of the agent's trace does a producing user actually want to see — and does the answer differ by user type?
- Where do confirm gates live: agent contract, template, user settings?
- When the user interrupts a job, do they edit the agent's plan or restart from a checkpoint?
- Does template authorship live in the same app, a separate "studio", or a web tool?
- How do existing WeatherV1 users transition to a templates-first UI without losing muscle memory?

## Relationship to other future work

- [`TEMPLATES.md`](TEMPLATES.md) — defines the unit this UI is built around.
- [`AI_NATIVE_PIPELINE.md`](AI_NATIVE_PIPELINE.md) — defines the agent loop and tool surface; the trace UI here is the visible face of that loop.
- [`PRODUCT_DIRECTION.md`](PRODUCT_DIRECTION.md) — sets the audience and tier the UX serves.
- [`LOCALIZATION.md`](LOCALIZATION.md) — owns the per-locale *content* and taxonomy concerns; this doc only owns RTL/LTR *display*.
- [`QUALITY_AND_EVAL.md`](QUALITY_AND_EVAL.md) — drives the "did this pass" UI in the job record.

## Non-goals

No screens, wireframes, component names, or design-system specifics. No accessibility audit. No commitment that any of this will ship. No claim that the current UI is wrong for what it does today — only that it would not survive a templates-and-agent reshape unchanged.
