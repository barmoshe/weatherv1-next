# Vision: Quality and editorial evaluation

> Status: vision / discovery, research-grounded. No code or eval-framework proposed. Sibling docs: [`TEMPLATES.md`](TEMPLATES.md), [`AI_NATIVE_PIPELINE.md`](AI_NATIVE_PIPELINE.md), [`UX_DIRECTION.md`](UX_DIRECTION.md), [`PRODUCT_DIRECTION.md`](PRODUCT_DIRECTION.md), [`MODEL_STRATEGY.md`](MODEL_STRATEGY.md), [`DATA_AND_CONTENT.md`](DATA_AND_CONTENT.md), [`DISTRIBUTION.md`](DISTRIBUTION.md), [`ECOSYSTEM.md`](ECOSYSTEM.md), [`LOCALIZATION.md`](LOCALIZATION.md).

## Scope

This doc owns the **editorial-correctness layer**: how we judge whether a template's *rendered output* meets the domain's standard for "good", how per-template golden sets and rubrics are authored and maintained, how reviewers work, how ship/no-ship calls get made, and how regression is detected over time.

It is **distinct from engineering-level evals** ([`AI_NATIVE_PIPELINE.md`](AI_NATIVE_PIPELINE.md) owns those — "did the agent's trajectory and tool-calls work"). This doc owns the layer above: "did the resulting video meet the editorial bar a weather producer / readiness officer / educator would hold it to". Two layers; both needed.

It does **not** cover: the template concept ([`TEMPLATES.md`](TEMPLATES.md)), how reviewers see the eval surface ([`UX_DIRECTION.md`](UX_DIRECTION.md)), per-locale editorial conventions ([`LOCALIZATION.md`](LOCALIZATION.md)), or asset-level data quality ([`DATA_AND_CONTENT.md`](DATA_AND_CONTENT.md)).

## Why this exists

The pipeline can be technically perfect — all tools called, no errors — and still produce a bad video: wrong clips, off-tone narration, captions that miss a beat. Engineering evals will miss this entirely. The pieces that define "good" — golden sets, rubrics, ship thresholds — are domain-specific and travel with the template, not the platform. Recording the conceptual model early lets the platform ship the *shared* eval infrastructure (judge runner, dashboard, sign-off gate) without prejudging what counts as good for any one domain.

## The two-layer split, in one paragraph

The platform supplies eval **infrastructure** (judge runner, swap-test harness, human-review queue, drift dashboard, sign-off gate). The template author supplies eval **content** (golden set, weighted rubric, ship thresholds, 10–20 seed examples). Authors never touch judge prompts or drift code; they only own the rubric and the golden set. This contract is what makes editorial quality scale across templates without re-implementing eval infrastructure for each one.

## Gate on the spec layer, route to humans for the editorial layer

Broadcast QC is bifurcated by design. File-based QC tools — Telestream Vidchecker, Interra Baton, the now-retired Tektronix Cerify (migration path: Telestream Qualify) — enforce *deterministic* checks: EBU R128 loudness (−23 LUFS ±0.2 LU), video legality, captions presence and reading-speed, DPP/Netflix/iTunes delivery templates ([Telestream Vidchecker](https://www.telestream.net/vidchecker/overview.htm), [Shade — Cerify status](https://shade.inc/blog/cerify-for-post-production)). They never claim to judge whether a piece "tells the story right".

GrayMeta's 2025 industry piece frames modern QC as "beyond pass/fail": automated QC catches the artefacts a human won't notice (a single dropped frame, a loudness spike); humans catch what automation can't (a misleading lower-third, a tone-deaf cut) ([GrayMeta — beyond pass/fail](https://graymeta.com/2025/02/10/video-qc-in-the-media-supply-chain-goes-beyond-pass-fail/), [Promwad — AI-QC](https://promwad.com/news/ai-qc-automated-quality-control-broadcasting-detecting-artifacts-loudness-subtitle-errors)).

**The translation: gate on the spec layer (loudness, captions, duration, codec) → route to a human for the editorial layer ("does this forecast sound like a forecast"). Both gates exist; neither alone is enough.**

## Generative-video metrics: useful per-dimension, misleading in aggregate

FVD and CLIPScore plateau on easy semantics and miss the things that matter for editorial video. **VBench** (CVPR 2024) and VBench-2.0 (2025) decompose "quality" into 16+ dimensions — human fidelity, physics, commonsense, controllability — and the authors explicitly show models can score near-ceiling on Object Class / Human Action while failing compositional or causal reasoning ([VBench](https://vchitect.github.io/VBench-project/)). **EvalCrafter** uses 700 prompts × 17 objective metrics for the same reason: no single number captures generative quality ([EvalCrafter CVPR 2024](https://openaccess.thecvf.com/content/CVPR2024/papers/Liu_EvalCrafter_Benchmarking_and_Evaluating_Large_Video_Generation_Models_CVPR_2024_paper.pdf)).

Forced-choice **pairwise human eval** has the lowest variance; **MOS** is noisier but easier to chart over time ([Mantiuk — four-method comparison](https://www.cl.cam.ac.uk/~rkm38/pdfs/mantiuk12cfms.pdf), [VideoScore](https://arxiv.org/html/2406.15252v2)). **Use pairwise for ranked decisions ("is the new picker better?"); use MOS for absolute drift tracking.**

## Golden sets: small, curated, rubric-graded

Across Arize, Snorkel, Microsoft's RAG guidance, and Innodata, the consensus is: build the **smallest set that *covers* the input space** (representative cases + known edge cases + known failure modes), authored by SMEs, grown only when a new failure mode appears in production. The size signal is *coverage*, not row count ([Arize — Golden Dataset](https://arize.com/resource/golden-dataset/), [Microsoft — golden dataset for RAG](https://medium.com/data-science-at-microsoft/the-path-to-a-golden-dataset-or-how-to-evaluate-your-rag-045e23d1f13f), [Innodata — golden datasets in AI](https://innodata.com/what-are-golden-datasets-in-ai/)).

Working numbers: **10–20 to start, 100–200 to ship, a few hundred to monitor.**

For subjective domains, golden sets are **rubric-graded, not single-answer**. OpenAI's HealthBench had 260+ physicians author 48,562 weighted criteria across thousands of conversations: every example carries its own rubric, criteria are weighted by importance, the rubric *is* the ground truth ([Snorkel — rubric design](https://snorkel.ai/blog/the-science-of-rubric-design/), [Rubric methodologies, April 2026](https://medium.com/@adnanmasood/rubric-based-evals-llm-as-a-judge-methodologies-and-empirical-validation-in-domain-context-71936b989e80)).

**The template's golden set is *(input, rubric)* pairs, not *(input, expected_output)* pairs.**

## Reviewer workflow: calibration is what holds judgement together

At scale, **the only thing that holds reviewer judgement together is calibration sessions + disagreement adjudication**. TikTok's transparency reports describe 40,000+ moderators reviewing the 6% of content automation cannot resolve, with 97.6% of automated decisions and 99.2% overall accuracy *after* a calibration pipeline ([TikTok DSA report](https://newsroom.tiktok.com/digital-services-act-our-sixth-transparency-report-on-content-moderation-in-europe?lang=en-150)).

Industry pattern: written guidelines + sample-and-grade calibration rounds + a tiebreaker reviewer for disagreements + rotation to mitigate fatigue. Creative-agency QA follows the same shape — checklists upstream, contextual review downstream, structured rejection codes ([Creative approval workflow](https://sizeim.com/2025/11/03/creative-approval-workflow-a-step-by-step-guide-for-agencies-templates-checklist/)).

## Ship / no-ship: capability suites + safety thresholds + qualitative review

Frontier labs gate releases on a combination, not a single number. Anthropic's Opus 4.5, Sonnet 4.5/4.6, and Haiku 4.5 system cards (2025) all show the same shape: a fixed eval suite run pre-deployment, RSP-mandated safety evals, alignment evals (sycophancy, sabotage, awareness), plus a written deployment justification ([Anthropic system cards](https://www.anthropic.com/system-cards)). The OpenAI–Anthropic 2025 cross-eval reinforced that no lab ships on metrics alone — there is always a human "is this OK to release" call gated on the numbers ([OpenAI–Anthropic 2025 cross-eval](https://openai.com/index/openai-anthropic-safety-evaluation/)).

**Translate as: per-template release requires (a) golden-set score ≥ threshold, (b) zero regressions on critical rubric items, (c) named reviewer sign-off.** Any one alone is insufficient.

## LLM-as-judge: usable for triage, not for ship/no-ship alone

Frontier judges still fail 50%+ of advanced bias tests. Documented failure modes (2025–2026): **position bias** (favours first/last candidate), **verbosity bias** (longer = better), **self-preference** (favours outputs that look like the judge's own distribution), **prompt sensitivity** (rubric order, ID numbering changes scores) ([Adaline — 50%+ bias failure](https://www.adaline.ai/blog/llm-as-a-judge-reliability-bias), [Judging the Judges IJCNLP 2025](https://aclanthology.org/2025.ijcnlp-long.18/)).

Mitigations that work: **swap tests** (run both orderings), **randomised IDs**, **rubric items scored independently** rather than holistically, **anchoring with reference exemplars** ([Arize — LLM-as-Judge primer](https://arize.com/llm-as-a-judge/)).

**Don't use LLM-judge alone for ship/no-ship. Use it for triage and drift monitoring.**

## Regression detection: per-dimension scores over rolling windows

Generative drift detection is moving from distributional drift to **semantic-similarity + judge-score tracking**. Evidently AI (open-source), WhyLabs (Apache 2.0 as of Jan 2025), and Arize converged on the same recipe for LLM/genAI: track per-dimension scores from a reference-grade judge over rolling windows, alert on slice-level regressions, surface concrete examples for each alert ([Evidently — data drift](https://www.evidentlyai.com/ml-in-production/data-drift), [ML monitoring tools comparison](https://medium.com/@tanish.kandivlikar1412/comprehensive-comparison-of-ml-model-monitoring-tools-evidently-ai-alibi-detect-nannyml-a016d7dd8219)).

**Minimum viable regression UI:** a per-template dashboard with one panel per rubric dimension, week-over-week deltas, slice by input type (e.g. severe-weather vs. routine forecast), and a "show me 5 failing examples" affordance.

## Per-template editorial standards: shared infra, separate criteria

The explicit lesson from HealthBench (medicine), HumanEval / SWE-bench (code), Spider / BIRD (SQL): **the shape of the eval is reusable; the criteria are not.** Criteria must be authored by domain experts and weighted per-template ([Snorkel — A-Z of rubrics](https://snorkel.ai/blog/the-right-tool-for-the-job-an-a-z-of-rubrics/), [Toloka — domain rubrics](https://toloka.ai/blog/evaluating-model-reasoning-with-rubrics-building-a-domain-specific-evaluation-dataset/)).

**The contract between this doc and [`TEMPLATES.md`](TEMPLATES.md):** a template ships a rubric (criteria + weights + critical-vs-nice-to-have + 10–20 seed examples). The platform consumes it. Authors do not touch judge code, dashboards, or sign-off mechanics — those are platform infrastructure.

## Design tensions worth flagging now

- **Per-template rubric vs. shared rubric library.** Per-template = honest but expensive to author; shared = cheaper to start with but rapidly becomes a lowest-common-denominator.
- **Judge model fidelity vs. cost.** Frontier judges (Opus, GPT-5) are more reliable but expensive; smaller judges drift faster.
- **Reviewer authority.** Does named reviewer sign-off block ship, or is it advisory? If advisory, what *does* block ship?
- **Where eval runs.** In CI on every change (slow, thorough) vs. on a release branch (fast, riskier).
- **What counts as "the output".** The rendered MP4 only, or also the plan / picks / captions individually.
- **Drift alert sensitivity.** Tight = alert fatigue; loose = quality regresses silently before anyone notices.
- **Failure-mode coverage debt.** Every production failure should add to the golden set — but who maintains it as it grows?

## Open questions

- How big is "big enough" for WeatherV1's golden set before we earn the right to call it the reference template?
- Who is the named reviewer for a template the team didn't author?
- Does the platform host the golden sets, or do they ship with each template version?
- How do we evaluate templates that produce intentionally non-deterministic output (creative variation as a feature)?
- Is there a useful equivalent of EBU R128 / loudness compliance for *editorial* — a portable, objective spec that any reviewer would agree on?

## Relationship to other future work

- [`AI_NATIVE_PIPELINE.md`](AI_NATIVE_PIPELINE.md) — engineering evals beneath this layer.
- [`TEMPLATES.md`](TEMPLATES.md) — the artefact whose rubric this doc evaluates.
- [`UX_DIRECTION.md`](UX_DIRECTION.md) — the reviewer's surface, the drift dashboard, the sign-off button.
- [`MODEL_STRATEGY.md`](MODEL_STRATEGY.md) — which judge model is used and how it's pinned.
- [`DATA_AND_CONTENT.md`](DATA_AND_CONTENT.md) — the asset-level quality concerns underneath.
- [`PRODUCT_DIRECTION.md`](PRODUCT_DIRECTION.md) — whether editorial quality is a marketing axis (it usually is).

## Non-goals

No framework choice (Promptfoo, DeepEval, Braintrust, Inspect). No proposed rubric for WeatherV1. No commitment that ship/no-ship gates are enforced today. No multi-tenant SaaS framing.
