# Vision: AI model strategy

> Status: vision / discovery, research-grounded (data points as of May 2026). No vendor commitment proposed. Sibling docs: [`TEMPLATES.md`](TEMPLATES.md), [`AI_NATIVE_PIPELINE.md`](AI_NATIVE_PIPELINE.md), [`UX_DIRECTION.md`](UX_DIRECTION.md), [`PRODUCT_DIRECTION.md`](PRODUCT_DIRECTION.md), [`QUALITY_AND_EVAL.md`](QUALITY_AND_EVAL.md), [`DATA_AND_CONTENT.md`](DATA_AND_CONTENT.md), [`DISTRIBUTION.md`](DISTRIBUTION.md), [`ECOSYSTEM.md`](ECOSYSTEM.md), [`LOCALIZATION.md`](LOCALIZATION.md).

## Scope

This doc owns **which model for which job, who provides it, how versions roll forward**. Concerns: provider abstraction, cost-tier routing, local-inference for small models, model version pinning, open vs. closed weights, provider redundancy, per-template model preferences, BYOK economics, voice/vision/embedding sub-markets.

It does **not** cover: the agent loop / tool design ([`AI_NATIVE_PIPELINE.md`](AI_NATIVE_PIPELINE.md)), how the user sees cost ([`UX_DIRECTION.md`](UX_DIRECTION.md)), what the user is charged ([`PRODUCT_DIRECTION.md`](PRODUCT_DIRECTION.md)), or whether the model's output is *good* ([`QUALITY_AND_EVAL.md`](QUALITY_AND_EVAL.md)).

## Why this exists

The app today calls OpenAI Whisper for transcription, OpenAI GPT for scene planning + clip picking, optional Gemini for vision. Those choices were made when the product was single-domain and provider lock-in was an acceptable simplification. As templates multiply (each potentially preferring different models) and the provider landscape continues to fracture (open weights closing the gap on most jobs, frontier hosted models pulling ahead on the hardest ones), the model-selection question becomes a first-class architectural concern, not a per-call choice.

## The shape, in one paragraph

A thin provider abstraction at the platform layer. The platform ships sensible defaults per task type (planner, picker, vision, transcript, voice, embedding). Templates may declare model preferences in their manifest; the platform validates that the user has credentials for what the template asks for *before* the job starts. Pinned dated snapshots per template version, never `*-latest` aliases. One fallback provider per critical stage. BYOK today, optional managed tier later. Local inference where it's mature enough to be the cheap default, hosted where the quality gap demands it.

## Router gateways: real category, neutrality matters

In 2026, LiteLLM (self-hosted, OSS, OpenAI-shaped unified API over 100+ providers), Portkey (1,600+ models with budgets, guardrails, traces), OpenRouter (broadest hosted catalogue, easiest start), and Vercel AI Gateway (best inside the Vercel ecosystem, less neutral elsewhere) split the market ([Pinggy — 2026 router roundup](https://pinggy.io/blog/best_ai_llm_routers_openrouter_alternatives/), [TokenMix — LiteLLM alternatives](https://tokenmix.ai/blog/litellm-alternatives)). Typical $1k/month spend through LiteLLM costs roughly that plus ~$20–$50 of VPS; Portkey adds ~$49 platform fee.

**Native SDKs still win when you need provider-specific features** (Anthropic prompt caching headers, OpenAI structured outputs) without router lag. The right pattern for this app: a thin internal abstraction that *can* dispatch through a router but doesn't *have to*, so provider-specific features stay reachable.

## Cost-tier routing: works for difficulty, not for domain judgement

RouteLLM (ICLR 2025) reported 95% of GPT-4 quality with only ~14% strong-model calls after LLM-judge augmentation — a 75% cost reduction ([RouteLLM repo](https://github.com/lm-sys/RouteLLM)). NotDiamond ships similar promises in production ([VentureBeat on NotDiamond](https://venturebeat.com/ai/not-diamond-automatically-routes-your-query-to-the-best-llm)).

The 60× spread between Claude Haiku ($0.25/M) and Opus ($15/M) makes routing valuable, but the routers classify **prompt difficulty**, not whether your scene-planner needs Claude's instruction-following over Gemini's vision grounding.

**Treat automatic routers as a tier dispatcher for prompts you've already decided are "the same job, different difficulty", not as a substitute for picking a model per pipeline stage.**

## Local inference: viable on a producer's laptop for easy jobs

Ollama 0.19 (March 2026) put MLX behind Apple Silicon and roughly doubled decode throughput vs. the old Metal/llama.cpp path; MLX hits ~230 tok/s on benchmarked Qwen3.5 ([Contra Collective — Apple-Silicon comparison 2026](https://contracollective.com/blog/llama-cpp-vs-mlx-ollama-vllm-apple-silicon-2026), [Ollama — MLX post](https://ollama.com/blog/mlx)). whisper.cpp on an M5 Pro transcribes 60 min of audio in ~6 min (≈10× real-time) at WER comparable to hosted Whisper ([PromptQuorum — whisper benchmarks](https://www.promptquorum.com/power-local-llm/local-whisper-stt-comparison-2026)).

Recommended split:
- **Ollama** for daily dev.
- **MLX** for performance-critical Apple-Silicon.
- **llama.cpp** where cross-platform / CUDA / Vulkan is needed.

**Teams still pay for hosted on hard reasoning because the open-weights gap on GPQA-Diamond and Humanity's Last Exam is still meaningful.**

## Pin model versions or get silently swapped

OpenAI retired GPT-4o, GPT-4.1, GPT-4.1 mini, and o4-mini from ChatGPT on 13 Feb 2026, and the `chatgpt-4o-latest` snapshot was removed from the API on 17 Feb 2026 — *The Register* characterised later cycles as "two weeks' warning" ([OpenAI deprecations](https://developers.openai.com/api/docs/deprecations), [The Register — two-week deprecations](https://www.theregister.com/2026/01/30/openai_gpt_deprecations/)). Anthropic publishes a four-stage Active → Legacy → Deprecated → Retired lifecycle with at least 60 days' notice and a ~12-month tail after a successor ships ([Anthropic — deprecation policy](https://docs.anthropic.com/en/docs/about-claude/model-deprecations)).

**Lesson: never call `*-latest` aliases in production. Pin a dated snapshot per template version. Let releases bump it explicitly.** The cost of *not* pinning is silent behaviour regressions in already-shipped templates — which then look like editorial drift in the QUALITY_AND_EVAL dashboard.

## Open weights closed the coding gap; frontier still wins hardest reasoning

May 2026 leaderboards put GPT-5.5, Claude Opus 4.7, and Gemini 3.1 Pro at the top; **DeepSeek V3.2 is within 5–10 points of GPT-5 on most benchmarks at ~9× cheaper input tokens**; MiniMax M2.5 ties Claude Opus 4.6 on SWE-bench (80.2 vs. 80.8); GLM-5 leads open Arena Elo at 1451 ([Artificial Analysis leaderboard](https://artificialanalysis.ai/leaderboards/models), [AkitaOnRails — May 2026 benchmarks](https://akitaonrails.com/en/2026/04/24/llm-benchmarks-parte-3-deepseek-kimi-mimo/)).

- **For RAG, coding, classification** — open weights are the rational default.
- **For EU residency** (CLOUD Act exposure on US-headquartered hosted providers regardless of region) and **high-volume cost** — self-hosted Llama / Qwen / DeepSeek is the lever ([Lyceum — EU residency guide](https://lyceum.technology/magazine/eu-data-residency-ai-infrastructure/)).
- **For hardest scene-planning prompts** — keep closed-frontier.

## Provider redundancy: measurable risk, modest failover

Anthropic's API uptime over the 90 days before April 2026 was 98.95% (vs. the 99.99% cloud baseline); 294 OpenAI incidents tracked since Jan 2025. The minimum viable failover ([Maxim — failover guide](https://www.getmaxim.ai/articles/top-llm-failover-platforms-in-2026-a-buyers-guide/), [Portkey — failover patterns](https://portkey.ai/blog/failover-routing-strategies-for-llms-in-production/)):

1. Detect 429/500/502/503/504 + timeouts.
2. Retry with backoff on the same provider.
3. Fall back to a second provider on the same prompt shape.
4. Circuit breaker so an OPEN provider is skipped in milliseconds rather than waited on.

**For a BYOK consumer app, retries + a single fallback per pipeline stage is the right complexity ceiling.**

## Per-template model preferences with platform defaults

n8n exposes ~70 LangChain-backed nodes letting each workflow pick OpenAI/Anthropic/Ollama/Gemini per step; Zapier instead defaults to "AI by Zapier" (GPT-4o-mini) and only opens model choice when the user brings keys ([AIMultiple — no-code AI builders 2026](https://research.aimultiple.com/no-code-ai-agent-builders/), [n8n — advanced AI docs](https://docs.n8n.io/advanced-ai/)).

**The hybrid that wins:**
- Platform ships sensible defaults per task type (planner, picker, vision).
- Templates declare a `models: { planner: "claude-sonnet-4.7", vision: "gemini-3.1-pro" }` block.
- Platform validates the user has credentials for what the template asks for *before* the run starts.

## BYOK: honest pricing, hostile UX — Cursor's reversal as cautionary

Cursor deprecated BYOK in late 2025 after concluding that BYOK users were their heaviest load and zero subscription revenue, and that maintaining N provider auth/error/rate-limit shapes slowed core work. They moved to a $20 credit pool at $20/mo Pro ([Cursor — pricing 2026](https://cursor.com/pricing), [Morph — Cursor model pricing](https://www.morphllm.com/cursor-model-pricing)).

**For a local-first desktop app the calculus differs** — BYOK keeps you out of the payments business and gives users true cost transparency — **but expect:**

- Install friction (key creation flow).
- Mid-render 429s that surface to end users.
- No margin to subsidise improvements.

**Minimum mitigations:** validate keys on entry, surface quota/rate-limit errors with provider-attributable messaging, leave room for an optional managed tier later. The pricing-mechanism decision belongs in [`PRODUCT_DIRECTION.md`](PRODUCT_DIRECTION.md); this doc only documents the *operational* shape.

## Voice and vision: most fragmented, per-template choice

- **STT**: Whisper-family remains the value default (local via whisper.cpp, hosted via OpenAI/Baseten); Deepgram Nova-3 covers 36+ languages with sub-300ms streaming; Google STT covers 125+ languages; AssemblyAI is English-strong.
- **TTS**: ElevenLabs (70+ languages, best naturalness/cloning) for production VO; OpenAI TTS ($15/$30 per 1M chars) for cheap defaults; Cartesia Sonic (~40 ms TTFA) and Deepgram Aura-2 (~90 ms) for real-time agents.
- **Vision**: Gemini 3.1 Pro leads MMMU (86.1) and Video-MME (78.2); Claude 4.5 close on MMMU (85.4); Pixtral 12B leads open-source instruction-following.

([Deepgram vs ElevenLabs](https://deepgram.com/learn/deepgram-vs-elevenlabs), [AI Magicx — vision benchmarks](https://www.aimagicx.com/blog/claude-opus-4-6-vs-gpt-5-4-vs-gemini-3-1-benchmark-comparison-april-2026), [BentoML — open VLMs 2026](https://www.bentoml.com/blog/multimodal-ai-a-guide-to-open-source-vision-language-models))

**A multi-template, multi-language app should not lock voice / vision to one vendor.** Per-locale picks live in [`LOCALIZATION.md`](LOCALIZATION.md).

## Embeddings: pick once per template, budget for re-embedding

May 2026 MTEB: Cohere embed-v4 ~65.2; OpenAI text-embedding-3-large ~64.6; BGE-M3 ~63.0; Voyage-2 consistently retrieval-leading (~67.8 avg). Google's new multimodal embedding hits 67.71 retrieval and unifies text/image/video/audio/PDF in one 3072-dim space ([PE Collective — embeddings 2026](https://pecollective.com/tools/text-embedding-models-compared/), [Reintech — embeddings comparison 2026](https://reintech.io/blog/embedding-models-comparison-2026-openai-cohere-voyage-bge)). OpenAI's `text-embedding-3` line hasn't been refreshed since Jan 2024 and is now beaten by newer entrants.

**Practical rule: a template's catalogue is keyed by *(embedding_model_id, dim)*. Switching providers or vocabularies forces a full re-embed.** Lock the embedding model per template version, store the model id in the index, re-embed only on a deliberate template bump.

## Design tensions worth flagging now

- **Native SDKs vs. router gateways.** Native = full provider features; router = uniformity at cost of provider-specific levers.
- **Automatic routing vs. explicit per-stage choice.** Routers shine when prompts are interchangeable; less so when each pipeline stage genuinely needs a different model.
- **Local-first inference vs. hosted quality.** Local wins on cost and privacy; hosted wins on hardest reasoning. The line moves quarterly.
- **Pinning vs. tracking.** Pinned snapshots avoid drift; tracking `*-latest` captures improvements. Mostly pin; track only where the eval suite catches regressions cheaply.
- **One fallback provider vs. many.** One = simple; many = real resilience but exponentially more error surfaces to test.
- **BYOK vs. managed.** BYOK = honest; managed = better UX. Probably both, eventually.
- **Per-template model overrides vs. enforced defaults.** Overrides = flexibility; enforced = predictability of cost / quality.

## Open questions

- Do we adopt a router gateway from day one, or write a thin abstraction and add routing later?
- Where does WeatherV1's editorial quality genuinely require frontier vs. tolerate mid-tier?
- Is whisper.cpp local-by-default the right move, or does hosted Whisper still win on accuracy enough to keep paying?
- How does a template declare model preferences in a way that survives the underlying model's deprecation?
- When (if ever) does a managed tier with platform-paid model access become worth the operational cost?

## Relationship to other future work

- [`AI_NATIVE_PIPELINE.md`](AI_NATIVE_PIPELINE.md) — the agent loop that consumes whatever model this doc picks.
- [`QUALITY_AND_EVAL.md`](QUALITY_AND_EVAL.md) — how we detect when a model swap regresses output quality.
- [`UX_DIRECTION.md`](UX_DIRECTION.md) — how model choice and cost surface to the user.
- [`PRODUCT_DIRECTION.md`](PRODUCT_DIRECTION.md) — BYOK-vs-managed as a pricing decision.
- [`LOCALIZATION.md`](LOCALIZATION.md) — per-language voice and STT picks.
- [`TEMPLATES.md`](TEMPLATES.md) — model preferences as part of the template manifest.

## Non-goals

No vendor commitment. No router framework choice. No commitment to add managed-tier billing. No multi-tenant SaaS framing.
