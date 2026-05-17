# Vision: AI-native pipeline (engineering)

> Status: vision / discovery, research-grounded. No code changes proposed in this doc — only the engineering direction and the public-evidence trade-offs. Sibling docs: [`TEMPLATES.md`](TEMPLATES.md), [`UX_DIRECTION.md`](UX_DIRECTION.md), [`PRODUCT_DIRECTION.md`](PRODUCT_DIRECTION.md), [`QUALITY_AND_EVAL.md`](QUALITY_AND_EVAL.md), [`MODEL_STRATEGY.md`](MODEL_STRATEGY.md), [`DATA_AND_CONTENT.md`](DATA_AND_CONTENT.md), [`DISTRIBUTION.md`](DISTRIBUTION.md), [`ECOSYSTEM.md`](ECOSYSTEM.md), [`LOCALIZATION.md`](LOCALIZATION.md). Downstream of [`CATALOG_TAGGING_REDESIGN.md`](CATALOG_TAGGING_REDESIGN.md); not blocking it.

## Scope

This doc owns the **engineering architecture** shift: from a fixed chain of bespoke LLM calls (each returning JSON that imperative TypeScript branches on) to an agent-orchestrated pipeline where models invoke tools and the system records the trace. Concerns: agent patterns, tool design, observability, pipeline-level evaluation, the JSON-API-to-tools shift, cost and latency discipline.

It does **not** cover the rename ([`PRODUCT_DIRECTION.md`](PRODUCT_DIRECTION.md)), the user experience of the agent ([`UX_DIRECTION.md`](UX_DIRECTION.md)), editorial-output quality ([`QUALITY_AND_EVAL.md`](QUALITY_AND_EVAL.md)), or model selection ([`MODEL_STRATEGY.md`](MODEL_STRATEGY.md)). Each lives in its sibling.

## Why this exists

Today the pipeline runs in a hard-coded order — transcribe → plan scenes → pick clips → validate → render — with each stage a bespoke LLM call whose JSON output is parsed and branched on by imperative TypeScript. This shape is fine for the first template, costly to extend to the second, and structurally cannot recover from its own mistakes without explicit branches we have to write by hand. The shift this doc captures is twofold: stages become **tools an agent calls**, and editorial judgement moves *into the model's loop* instead of being encoded around it.

## The shape, in one paragraph

A planner-style agent owns the job from transcript to render, deciding when to plan, when to re-plan, when to search the catalogue, when to swap a pick, when to ask for help. The current linear stages become tools the agent calls in whatever order the job requires. Determinism and observability stay first-class — the agent's trace replaces today's plan bundle as the artefact of record. Cost ceilings, time budgets, and confirm gates are part of the agent's contract, not afterthoughts.

## Pick the simplest shape that works

Anthropic's *Building Effective Agents* draws a hard line: **workflows** are systems where "LLMs and tools are orchestrated through predefined code paths"; **agents** "dynamically direct their own processes and tool usage" ([Anthropic — Building Effective Agents](https://www.anthropic.com/engineering/building-effective-agents)). The canonical workflow vocabulary covers the great majority of LLM systems:

- **Prompt chaining** — sequential steps, each refining the previous.
- **Routing** — classify the input, dispatch to a specialised handler.
- **Parallelisation** — fan out (voting) or split independent work (sectioning).
- **Orchestrator-workers** — a coordinator delegates subtasks to workers.
- **Evaluator-optimizer** — generate, critique, regenerate.
- **Autonomous agent** — open-ended trajectory, terminates when the model decides it's done.

The principle to internalise: **start simple, escalate deliberately**. Each step up the ladder trades latency, cost, and debuggability for flexibility. You only adopt the next pattern when you can name the capability the previous one cannot deliver. For this project, today's pipeline is "prompt chaining"; a near-term step is "orchestrator-workers" with a planner and per-scene workers; "autonomous agent" is reserved for jobs whose trajectory genuinely can't be enumerated.

## Tools are the leverage point

Anthropic's *Writing Effective Tools for AI Agents* reframes tool design as "a contract between deterministic systems and non-deterministic agents" — not a port of an internal REST API ([Anthropic — Writing Tools for Agents](https://www.anthropic.com/engineering/writing-tools-for-agents)). The five levers that generalise across providers:

- **Choose the right tools** — fewer, higher-leverage, not a 1:1 mirror of endpoints. Ambiguity between tools is where agents waste turns.
- **Namespace them so boundaries are obvious to the model.**
- **Return meaningful context** — errors that suggest a next action, not stack traces. The model will retry, hallucinate arguments, and sequence calls in ways you did not anticipate; a tool that throws on a duplicate call forces the agent into recovery loops that burn tokens and time.
- **Optimise for token efficiency** in both descriptions and responses.
- **Prompt-engineer the descriptions themselves** — they are read by the model, not by humans.

**Side-effecting tools must be idempotent or carry an operation ID.** This is the single most-important contract: retries are inevitable; tools that aren't safe to retry will produce duplicate renders, double-uploaded assets, or worse.

## Framework landscape (2026)

The agent framework landscape has converged on a shape — *loop + tool registry + scoped memory + checkpoint/resume + MCP-style transport* — and diverged on orchestration philosophy:

- **LangGraph** — directed graph plus persistence; leads on stateful, human-in-the-loop production work.
- **OpenAI Agents SDK** (March 2025, replacing Swarm) — centres on explicit *handoffs* between agents.
- **Anthropic Claude Agent SDK** — deliberately minimal; treats sub-agents as tools.
- **CrewAI** — role-based multi-agent prototyping.
- **Microsoft Agent Framework** (AutoGen moved to maintenance) — enterprise-flavoured.

What's table stakes by 2026: tool registry, persistent memory, checkpoint/resume, OpenTelemetry instrumentation, MCP transport. What's a real choice: graph-shaped vs. handoff-shaped vs. tool-shaped orchestration ([QubitTool 2026 framework comparison](https://qubittool.com/blog/ai-agent-framework-comparison-2026), [Morph LLM — Agent frameworks 2026](https://www.morphllm.com/ai-agent-framework)). This doc takes no position on which framework, only that the choice should be made deliberately, after the simpler workflow patterns have been exhausted.

## Observability is standardising on OpenTelemetry

As of Semantic Conventions 1.40.0 (April 2026) the OpenTelemetry GenAI and MCP convention pages remain at "Development" status, but the shape is settled: LLM client spans, agent spans, prompt/completion events, and metrics ([OTel GenAI conventions](https://opentelemetry.io/docs/specs/semconv/gen-ai/), [OTel blog — Inside the LLM Call](https://opentelemetry.io/blog/2026/genai-observability/)). Datadog, Honeycomb, and New Relic emit them; LangChain, CrewAI, AutoGen, and LangGraph instrument to them.

What's table stakes: per-call traces with token + cost attributes, tool-call spans, and trace-linked evals. What's emerging: agent-task spans, memory spans, and framework-specific conventions. Vendor sort: LangSmith (LangChain-native, highest lock-in), Langfuse (OSS, OTel-first, ClickHouse-acquired Jan 2026), Arize Phoenix (drift + embedding analysis), Helicone, Datadog, Honeycomb ([Langfuse vs. alternatives](https://langfuse.com/faq/all/best-phoenix-arize-alternatives)).

The framing that ties this together is the **Agent Development Lifecycle**: observe → evaluate → policy, with the control-plane principle that "agents decide, control planes govern, execution environments enforce, and systems generate evidence" ([IBM — ADLC](https://www.ibm.com/think/topics/agent-development-lifecycle-adlc), [EPAM — Agentic Development Lifecycle](https://www.epam.com/insights/ai/blogs/agentic-development-lifecycle-explained)).

## Pipeline evaluation must score trajectories, not single outputs

For non-deterministic systems, the same input can validly produce different tool sequences. Single-shot exact-match eval is the wrong tool. The mature pattern pairs:

- **A CI-gating framework** (Promptfoo, DeepEval, Inspect) running a small (20–50 case) golden set under five minutes, expanded as production failures arrive.
- **A platform for datasets, human annotation, and regression dashboards** (Braintrust, LangSmith, Langfuse).

Working defaults: **thresholds, not exact match** (e.g. relevance ≥ 0.8); **multi-trial runs averaged to a pass rate**; **LLM-as-judge** for fuzzy quality; **human-in-the-loop sampling** to catch what judges miss; **trace-level scoring** (did the agent pick the right tool, in roughly the right order, and reach a correct end state?) is the agent-specific layer that single-shot eval cannot express ([Braintrust — Agent evaluation](https://www.braintrust.dev/articles/agent-evaluation), [Braintrust — DeepEval alternatives 2026](https://www.braintrust.dev/articles/deepeval-alternatives-2026), [Inference.net — LLM eval tools 2026](https://inference.net/content/llm-evaluation-tools-comparison/)).

This is **pipeline-level eval** — "did the agent's process work". The **editorial-output eval** layer — "did the rendered video meet the domain's quality bar" — is a different concern and lives in [`QUALITY_AND_EVAL.md`](QUALITY_AND_EVAL.md).

## JSON-mode vs. tool-calls is a real trade-off

Most regrets cluster on two failure modes ([buildmvpfast — JSON Mode vs Function Calling vs Structured Output (2026)](https://www.buildmvpfast.com/blog/structured-output-llm-json-mode-function-calling-production-guide-2026), [Vellum — when to use each](https://www.vellum.ai/blog/when-should-i-use-function-calling-structured-outputs-or-json-mode)):

- **Regret #1**: shipping a chain of `response_format: json_object` calls that imperative code branches on. This is the architecture we replace, because every new decision forces a schema migration and the model cannot recover from a bad branch.
- **Regret #2**: forcing strict-JSON output inside a reasoning step. Measured ~10–15% degradation on reasoning quality, fixable by separating "think" and "format" calls.

The 2026 default: **tools for actions and decisions; structured outputs for terminal payloads; combine them when an agent must both act and return a typed result.**

## Cost and latency regress silently — discipline is enforcement, not reporting

Agents burn approximately 50× the tokens of a chat turn because every sub-agent response feeds back into the orchestrator context and input tokens are re-charged each turn ([LeanOps — Agents burn 50× tokens](https://leanopstech.com/blog/agentic-ai-cost-runaway-token-budget-2026/)). The four levers that actually work:

- **Prompt caching** on stable system + tool definitions (cached input at 10–25% of normal; ~90% input reduction on long prefixes).
- **Model-tier routing** — small models for grunt work, frontier for hard reasoning ([`MODEL_STRATEGY.md`](MODEL_STRATEGY.md) owns the picking logic).
- **Per-task / per-user budget caps and tool-call ceilings**, enforced *before* spend.
- **Aggressive context pruning** between turns.

The pattern is a control plane that hard-caps tool calls and token budgets at runtime — soft alerts catch nothing once an agent enters a retry loop ([Harness — cost optimization for production agents](https://harnessengineering.academy/blog/cost-optimization-production-ai-agents-token-budgets-model-selection-caching/)).

## What stays invariant

Local-first; the workspace + R2 sidecar model; the renderer-facing API contract; desktop runtime guarantees (loopback ports, session-token auth, no remote URLs in ffmpeg, no permanent R2 keys on disk); the reproducibility of a finished job from its recorded artefacts.

## Design tensions worth flagging now

- **Agent autonomy vs. predictability of cost and runtime.** The same job, twice, may cost very differently.
- **Tools the agent can call freely vs. tools that require human confirmation.** The line is per-template editorial choice, and how it lands in UI is [`UX_DIRECTION.md`](UX_DIRECTION.md).
- **One orchestrator vs. several specialists.** Planner / picker / critic as separate agents (handoff-shaped) vs. one loop with many tools.
- **How much state the agent carries between turns.** Full conversation history (expensive, simple) vs. compacted memory (cheap, complex).
- **Framework choice as architectural lock-in.** LangGraph, Agents SDK, Claude Agent SDK each shape the rest of the code differently.
- **When to admit you don't need an agent.** Some stages (transcription, render) genuinely are deterministic and should stay so.

## Open questions

- Does an agentic core need a workflow engine underneath (Temporal-style), and how does that interact with the existing `temporal/` research?
- Which framework — or none — wins for this project, and what would make us regret the choice?
- What does "reproducible job" mean when the pipeline is non-deterministic — exact-byte vs. equivalent-trace vs. equivalent-output?
- Do we instrument to OTel GenAI conventions from day one, or pick a vendor first and migrate?

## Relationship to other future work

- [`QUALITY_AND_EVAL.md`](QUALITY_AND_EVAL.md) — editorial-output layer above the engineering evals here.
- [`MODEL_STRATEGY.md`](MODEL_STRATEGY.md) — which model for which job; this doc only talks about *that* the agent picks tools, not which model picks them.
- [`UX_DIRECTION.md`](UX_DIRECTION.md) — what the agent loop looks like from the user's seat (trace UI, confirm gates).
- [`PRODUCT_DIRECTION.md`](PRODUCT_DIRECTION.md) — the rename and the positioning weight of being "agent-native" rather than "LLM-using".
- [`CATALOG_TAGGING_REDESIGN.md`](CATALOG_TAGGING_REDESIGN.md) — the most upstream piece; richer tags make tool surfaces cleaner.
- `temporal/` research — durability, idempotency, observability questions raised there become more pressing once orchestration moves out of straight-line TypeScript.

## Non-goals

No framework choice. No API design. No commitment to ship any of this. No multi-tenant SaaS framing — single-tenant invariant stays. No claim that "agentic" is strictly better than the current shape — only that the choice is worth making deliberately rather than by default.
