# Vision: Templates as the unit of choice

> Status: vision / discovery, research-grounded. No code changes proposed in this doc — only the conceptual model, the public-evidence trade-offs, and the open questions to chew on before we entrench the current shape. Sibling docs (each owning a different concern): [`AI_NATIVE_PIPELINE.md`](AI_NATIVE_PIPELINE.md) (engineering), [`UX_DIRECTION.md`](UX_DIRECTION.md) (experience), [`PRODUCT_DIRECTION.md`](PRODUCT_DIRECTION.md) (positioning, rename, pricing), [`DATA_AND_CONTENT.md`](DATA_AND_CONTENT.md) (asset lifecycle), [`QUALITY_AND_EVAL.md`](QUALITY_AND_EVAL.md) (editorial correctness), [`DISTRIBUTION.md`](DISTRIBUTION.md) (release engineering), [`MODEL_STRATEGY.md`](MODEL_STRATEGY.md) (provider strategy), [`ECOSYSTEM.md`](ECOSYSTEM.md) (author DX), [`LOCALIZATION.md`](LOCALIZATION.md) (per-locale content). Downstream of [`CATALOG_TAGGING_REDESIGN.md`](CATALOG_TAGGING_REDESIGN.md); not blocking it.

## Scope

This doc owns: the *concept* of a template, what's inside one, how versioning and authorship work as platform primitives, and what "WeatherV1 as the reference template" means. It does **not** cover how templates are picked in the UI, sold as a product, distributed as binaries, or how their *output* is judged for editorial quality — each of those lives in its sibling.

## Why this exists

The app is single-purpose today: a Hebrew weather forecast tool. The pipeline shape underneath is not weather-specific — transcribe narration, plan scenes, pick visuals, validate, render. The same shape serves a readiness briefing, an education explainer, a market wrap-up. Recording the *template* concept early — and being deliberate about what a template is and isn't — keeps the option open without prejudging whether we'll ever ship the second one. Foundational work in flight (the tagging redesign, prompt iteration, validator hardening) is much cheaper to make template-shaped now than template-shaped later.

## The concept, in one paragraph

A **template** is the unit of choice a user makes at the start of a job: "produce a weather forecast", "produce a readiness brief", "produce an explainer". Each template bundles everything that makes *that kind of video* what it is — its clip catalogue, its taxonomy, the editorial voice of its prompts, its validator's notion of "obvious mismatch", its output aspect and length conventions, and its surface branding. Only one template is active per job. Templates do not share clips or vocabularies, but they do share the generic pipeline and runtime. **WeatherV1 is the inaugural / reference template** — the one whose existence proves the shape and against which new templates can be benchmarked.

## What a template plausibly contains

The cross-platform convention, lifted from how successful systems define plugin/skill/template artefacts, is **manifest + body + typed configuration surface + resources**. Claude Skills crystallise this as a `SKILL.md` directory with YAML frontmatter (`name`, `description`), markdown body loaded on demand, and optional executable scripts — a discoverable manifest the runtime indexes without loading the body ([Anthropic — Agent Skills](https://www.anthropic.com/news/skills); [Anthropic engineering — Equipping agents with skills](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills)). LangGraph templates expose "configurable fields" (model, vector store, schema) over working code ([LangChain — Launching LangGraph Templates](https://blog.langchain.com/launching-langgraph-templates/)). Cookiecutter requires a `cookiecutter.json` declaring variables the user fills in at instantiation ([Cookiecutter docs](https://cookiecutter.readthedocs.io/en/1.7.0/README.html)).

A template's contents are best sketched, not contracted:

- **Manifest** — name, description, version, declared inputs, declared outputs, declared model preferences, owned by this template alone.
- **Catalogue** — the clip library; sees [`DATA_AND_CONTENT.md`](DATA_AND_CONTENT.md) for sourcing/rights/retention.
- **Taxonomy** — closed enumerations for the axes the picker filters on; free text for description only.
- **Editorial brief** — natural-language description of what *good* looks like in this domain; what the agent reads instead of a TypeScript rule.
- **Prompts** — planner, picker, validator (or, in the agentic future, the single brief the orchestrator reads).
- **Validator rules** — domain-specific "obvious mismatch" checks.
- **Output conventions** — aspect ratio, target length, music style, voice, caption format.
- **Brand surface** — name, splash, on-screen branding affordances.

How fat that bundle is allowed to be — pure data, or data + executable code — is itself a tension (below).

## Define what a template is *not*

Mature platforms split "template" from adjacent concepts with surgical precision. WordPress is the canonical example: **themes** control sitewide look, **templates** are page-level structures, **block patterns** are insertable layout fragments that "don't add features", **plugins** extend functionality ([Learn WordPress — patterns/templates/parts](https://learn.wordpress.org/tutorial/the-difference-between-reusable-blocks-block-patterns-templates-and-template-parts/)). Make.com renames Zapier's "Zaps/steps/paths" to "scenarios/modules/routes" — same primitive, different category, and "automations cannot be imported directly" between them ([Zapier vs Make](https://zapier.com/blog/zapier-vs-make/)). The discipline is: **pick one canonical word and rigorously define what it does not cover** (preset, recipe, project, asset pack, profile). Otherwise the meaning rots within two releases.

For this project, the working line:

- **Template** = the unit of choice at job start (the thing this doc is about).
- **Preset** = a user-saved configuration inside a template (e.g. "my Friday evening setup").
- **Project** = a single job's working state.
- **Asset pack** = a bundle of clips that may be referenced by a template but isn't one.

## What "WeatherV1 as the reference template" means

- It is the template against which the generic pipeline is benchmarked: anything the generic pipeline does should at least keep working for WeatherV1.
- It is the template new ones can be modelled on. Industry-vertical "templates" sell when they ship *opinions*, not blanks — Salesforce Industry Clouds bundle "best practices, templates, workflows, and data models" that "speak the language of the industry" ([Titan — Salesforce Industry Clouds](https://titandxp.com/article/sf/industry/)). WeatherV1 must be the opinionated reference; "make any video" is not the pitch.
- It is the template that gets the most depth (rich taxonomy, polished prompts, validator rules earned from real failure modes) — partly because it shipped first, partly because depth there is what proves the templates concept is real and not vapourware.
- It is *not* a privileged template at runtime. The pipeline treats it the same as any other.

## Versioning: immutable manifests, explicit upgrade

Versioning is the single hardest problem in template systems, and most platforms either punt or pay heavily later. Two patterns dominate:

- **Pin-by-default.** React Native's template proposal recommends users "pin the template version" so upgrades stay explicit ([RN community template versioning](https://github.com/react-native-community/cli/issues/2345)). Helm charts use two semver lines: `appVersion` for content, `version` for manifest ([Semgrep — manifests, lockfiles, SemVer](https://semgrep.dev/blog/2023/efficient-dependency-management/)).
- **No upstream at all.** Figma Community remixes are detached copies with attribution conventions; there is no upstream pull, no "new version available" prompt ([Figma Community copyright/licensing](https://help.figma.com/hc/en-us/articles/360042296374-Figma-Community-copyright-and-licensing)).

For a job-shaped product, the safe pattern is **templates as immutable manifests**: a running job captures the template version it instantiated; a published version is never rewritten; "new version available" is an explicit prompt, not silent migration. Job replay against an older template version stays meaningful indefinitely. Where this lives operationally (signing, channels, rollback) belongs in [`DISTRIBUTION.md`](DISTRIBUTION.md).

## Authorship and trust

Authorship models cluster into four patterns with very different operational costs:

- **Curated marketplace** — Webflow Marketplace: creators license direct to end users, must provide their own ToS and support, submission gated by review ([Webflow Marketplace Agreement](https://webflow.com/legal/marketplace-agreement)).
- **Open marketplace with weak gates** — WordPress.org, ThemeForest: ~3-month review queues; "inconsistent accessibility checks" and security audits that miss dependency issues ([Freemius — ThemeForest vs WordPress.org review](https://freemius.com/blog/themeforest-wordpress-org-theme-review-process/)).
- **Git-shaped / scaffolder** — Cookiecutter, Yeoman, `npx create-*`: zero gatekeeping, attribution via repo URL, no native monetization.
- **Open-standard hybrid** — Claude Skills' `SKILL.md` is an open spec runnable across multiple agent runtimes; portability is the moat, not the marketplace ([agensi.io — SKILL.md vs CLAUDE.md vs .cursorrules](https://www.agensi.io/learn/skill-md-vs-claude-md-vs-cursorrules)).

The marketplace economics question — who pays whom, who curates — lives in [`PRODUCT_DIRECTION.md`](PRODUCT_DIRECTION.md). The author developer-experience question — scaffolding, docs, contributor onboarding — lives in [`ECOSYSTEM.md`](ECOSYSTEM.md). This doc only takes the position that **whichever authorship model is chosen should be declared, not drifted into.**

## Failure modes worth designing against

- **The GPT Store outcome.** 3M+ custom GPTs created, only 159,000 made it to the store — 95% attrition. The named causes: monetization promises never delivered, search "like looking for a needle in a haystack", configurations easily duplicated leading to clones of popular GPTs, moderation gaps, and architectural lock-in (no model choice, chatbot-only UI) ([Why OpenAI's GPT Store Failed to Gain Traction](https://sallysliu.medium.com/why-openais-gpt-store-failed-to-gain-traction-7783972a5f90); [OpenAI Struggles With GPT Store Moderation](https://winbuzzer.com/2024/09/05/openai-struggles-with-gpt-store-policy-enforcement-xcxwbn/)). Implication: a templates marketplace, if it ever exists, needs an answer to *all four* of those before opening.
- **Template fatigue.** "Creators are not tired of templates — they are tired of *looking like one*" ([Kittl — template fatigue](https://www.kittl.com/blogs/template-fatigue-design-dsi/)). Opinionated templates that produce visibly different outputs avoid this; bland scaffolds do not.
- **Template sprawl.** In ops domains, undisciplined template proliferation produces "hundreds, if not thousands of pipeline configurations that become completely unmanageable" ([Harness — Flexible Template Governance](https://www.harness.io/blog/flexible-governance-solving-the-all-or-nothing-problem-in-pipeline-templates)). The structural defence is **a small curated root set plus a clear policy for who can promote a user template into the canonical catalog**.

## Design tensions worth flagging now

- **How fat a template is.** Pure data (catalogue + taxonomy + brief), or data + executable code (custom tools, validators, output steps). Fatter = more powerful + harder to onboard, sandbox, and trust.
- **The configurable-surface size.** Zero knobs → not really a template. Hundreds of knobs → not really a template either. The line is where the user can change *intent* but not *shape*.
- **Sharing primitives across templates.** Music libraries, intro/outro affordances, voice models, eval harness — shared infrastructure, or per-template?
- **Lifecycle granularity.** Major version (semver `1.x → 2.x`) vs. content patch (new clips, prompt tweak). What's a breaking change in a template — and is "breaking" a useful word here, or do we need different vocabulary because templates don't have callers in the API sense?
- **Reference-template privilege.** WeatherV1's depth could make it feel special at runtime even if architecturally it isn't. Whether that's a feature or a bug.
- **Word choice.** "Template" carries baggage (slideshow templates, email templates). Alternatives — preset, recipe, format, channel, pack, kit — each cue different mental models. Conviction on the word matters because every subsequent doc inherits it.

## Relationship to other future work

- [`AI_NATIVE_PIPELINE.md`](AI_NATIVE_PIPELINE.md) — the engineering of the agent the template is read by.
- [`UX_DIRECTION.md`](UX_DIRECTION.md) — what picking and using a template looks like from the user's seat.
- [`PRODUCT_DIRECTION.md`](PRODUCT_DIRECTION.md) — marketplace economics, the rename, positioning.
- [`DATA_AND_CONTENT.md`](DATA_AND_CONTENT.md) — the catalogue inside a template, its sourcing and rights.
- [`QUALITY_AND_EVAL.md`](QUALITY_AND_EVAL.md) — how a template's *output* is judged.
- [`DISTRIBUTION.md`](DISTRIBUTION.md) — how templates are published, signed, updated, rolled back.
- [`MODEL_STRATEGY.md`](MODEL_STRATEGY.md) — what a template can declare about model preferences.
- [`ECOSYSTEM.md`](ECOSYSTEM.md) — what authoring a template looks like for an external contributor.
- [`LOCALIZATION.md`](LOCALIZATION.md) — what varies in a template per locale beyond translated strings.
- [`CATALOG_TAGGING_REDESIGN.md`](CATALOG_TAGGING_REDESIGN.md) — the most upstream piece. The natural place to let the tag schema *travel with the catalogue* rather than live in source, which keeps the templates option open without committing to it.

## Non-goals

No implementation plan. No proposed file format, file paths, env vars, or APIs. No commitment that templates will ever ship beyond the inaugural one. No multi-tenant SaaS framing — single-tenant invariant stays. No claim that WeatherV1 must be rewritten to fit a generic template shape *before* the platform earns the right to host a second one.

## Open questions

- Is "template" the right word, or does the product want different vocabulary (preset, recipe, format, channel, pack)?
- What exactly is *in* a template, and is the line drawn the same way for every template, or per-template?
- How does a template version itself — semver-by-content, semver-by-manifest, both, neither?
- Is the "configurable surface" typed (declared fields, validated) or freeform (a JSON blob the template's prompts read)?
- Does WeatherV1's reference status come with any *technical* privilege (always installed, can't be uninstalled, used in CI tests), or only editorial privilege?
