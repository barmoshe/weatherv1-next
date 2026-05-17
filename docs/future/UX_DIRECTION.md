# Vision: UX direction for a templates-first, agentic app

> Status: vision / discovery. No design proposed in this doc — only the experience-level questions and shifts to think about before the engineering work entrenches a particular UI shape. Sibling docs: [`TEMPLATES.md`](TEMPLATES.md), [`AI_NATIVE_PIPELINE.md`](AI_NATIVE_PIPELINE.md), [`PRODUCT_DIRECTION.md`](PRODUCT_DIRECTION.md).

## Why this exists

Today's UI is shaped around one job: produce a Hebrew weather forecast. The home screen is a workspace, the catalogue panel is *the* catalogue, the pipeline runs left-to-right with no real branching, and the user mostly watches. If templates become the unit of choice and the pipeline becomes agentic, the interface model has to evolve to match. This doc records the experience shifts we'd want to think through — not the screens to ship.

## The shape of the experience, in one paragraph

A user opens the app, sees the templates available to them, picks one (or resumes the last one used), and lands in a job space that is *shaped by that template*: its taxonomy in the filters, its brief on the side, its catalogue in the picker. Producing a video is a conversation with an agent that does most of the mechanical work — transcribing, planning, picking, validating — and shows its trace as it goes. The user steers at confirm gates, redirects when the agent goes wrong, and ships when satisfied. The same shell hosts every template; only the content inside it changes.

## Shifts worth designing for

- **From "the app" to "a template inside the app".** The home screen becomes a template gallery / picker, not a workspace. The current workspace becomes the *inside* of the active template's job space.
- **From step-by-step pipeline UI to agent-trace UI.** Today's screens map 1:1 onto pipeline stages (transcribe, plan, pick, render). An agentic pipeline doesn't have linear stages in the same way — the UI has to surface *what the agent is doing now, why, and what's coming next* without pretending it's a fixed wizard.
- **From "the app rendered this" to "the user can see and replay why".** The agent's trace becomes a first-class artefact in the UI: a navigable history of decisions, with the prompt, the tools called, and the alternatives considered. Re-running a scene becomes a UI gesture, not a backend script.
- **From "wait for it to finish" to "intervene any time".** The user can pause, re-plan a scene, swap a pick, re-tag a segment, or change the brief mid-job — without losing the work that came before.
- **From implicit cost to visible cost.** Agentic systems regress on cost silently. The UI has to make per-job cost and time legible *during* the job, not only after.
- **From an empty workspace to a guided onboarding per template.** Each template has its own assumed setup (a kind of catalogue, certain tags, certain assets). The shell has to scaffold a first-run experience that's template-aware, not generic.

## What stays the same

- Local-first. The user is operating against files on their machine; nothing happens to remote infrastructure they didn't ask for.
- One job at a time, recoverable. A job's artefacts (transcript, plan, trace, picks, render) survive a crash and a restart.
- Hebrew-first today, but not Hebrew-only. The shell stays RTL-capable; templates can declare their own language.
- The desktop and web runtimes render the same UI.

## Design tensions worth flagging now

- **Floor vs. ceiling.** A first-time user wants the agent to "just produce something"; a power user wants every knob. The UI has to serve both without becoming two products.
- **Transparency vs. clutter.** Showing every tool call the agent makes is honest but exhausting. Showing only milestones is calm but opaque. The right grain is per-template.
- **Determinism cues.** Users expect "same input → same output". An agentic pipeline doesn't guarantee that. The UI has to either signal non-determinism honestly or constrain the agent enough to keep determinism.
- **Confirm-gate fatigue.** Too few gates means surprise renders, runaway cost, irreversible publishes. Too many gates means the agent isn't doing anything for the user. Where the gates sit is a per-template editorial choice.
- **Template picker as homescreen.** Two templates: a list. Twenty: a gallery with search and categories. Two hundred: a marketplace. Each implies a different shell.
- **Template authorship surface.** If users can write templates, the app needs a *second* UI surface — a brief editor, a taxonomy editor, a prompt editor, an eval runner. That is a separate product inside the same shell.
- **RTL + LTR coexistence.** WeatherV1 is RTL Hebrew. A briefing or explainer template could be LTR English. The shell must switch direction per template without bleeding state across.
- **Continuity for existing users.** A Weather-only user's home screen suddenly becoming a template picker is a disruption. The transition needs a default-template fallback so the change is opt-in for a while.

## Relationship to other future work

- [`TEMPLATES.md`](TEMPLATES.md) — defines the unit this UI is built around. The shape of the template gallery and the job space inherits from what a template *is*.
- [`AI_NATIVE_PIPELINE.md`](AI_NATIVE_PIPELINE.md) — defines the agent loop and tool surface. The trace UI here is the visible face of that loop.
- [`PRODUCT_DIRECTION.md`](PRODUCT_DIRECTION.md) — sets the audience and tier the UX serves (in-house tool vs. external editors vs. a marketplace).

## Non-goals for this doc

No screens, wireframes, component names, or design-system specifics. No accessibility audit (that belongs in a real design pass). No commitment that any of this will ship. No claim that the current UI is wrong for what it does today — only that it would not survive a templates-and-agent reshape unchanged.

## Open questions

- Is the template picker the home screen, a modal, or a "new job" affordance from inside a default template?
- How much of the agent's trace does a producing user actually want to see — and is the answer different for a power user vs. a casual one?
- Where do confirm gates live: in the agent's contract (every render confirmed), in the template (template author decides), or in the user's settings?
- When the user interrupts a job, do they edit the agent's plan or restart from a checkpoint?
- Does template authorship live in the same app, a separate "studio" app, or a web tool?
- How do existing WeatherV1 users transition to a templates-first UI without losing muscle memory?
