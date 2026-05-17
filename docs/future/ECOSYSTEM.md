# Vision: Ecosystem and template-author DX

> Status: vision / discovery, research-grounded. No tooling or CLI proposed. Sibling docs: [`TEMPLATES.md`](TEMPLATES.md), [`AI_NATIVE_PIPELINE.md`](AI_NATIVE_PIPELINE.md), [`UX_DIRECTION.md`](UX_DIRECTION.md), [`PRODUCT_DIRECTION.md`](PRODUCT_DIRECTION.md), [`QUALITY_AND_EVAL.md`](QUALITY_AND_EVAL.md), [`MODEL_STRATEGY.md`](MODEL_STRATEGY.md), [`DATA_AND_CONTENT.md`](DATA_AND_CONTENT.md), [`DISTRIBUTION.md`](DISTRIBUTION.md), [`LOCALIZATION.md`](LOCALIZATION.md).

## Scope

This doc owns the **template-author developer experience**: how an external contributor discovers the platform, scaffolds their first template, gets a fast inner loop, finds answers, ships, evolves the template, and handles payments (if any). Concerns: scaffolding, hot-reload, docs, time-to-hello-world, community substrate, contributor metrics, showcases, reference implementation as teaching tool, platform-author relationship, supply-chain hygiene, author monetisation plumbing.

It does **not** cover: the technical schema of a template ([`TEMPLATES.md`](TEMPLATES.md)), marketplace economics or curated vs. open trade-offs ([`PRODUCT_DIRECTION.md`](PRODUCT_DIRECTION.md)), distribution mechanics ([`DISTRIBUTION.md`](DISTRIBUTION.md)), or platform-level engineering ([`AI_NATIVE_PIPELINE.md`](AI_NATIVE_PIPELINE.md)). This doc is conditional on the product direction landing on external authorship — until that decision is made, treat it as planning ahead, not a commitment.

## Why this exists

Ecosystems live or die on the first 15 minutes of a contributor's experience. If the second template ever gets built by someone outside the team, the inner loop, docs, and community substrate they encounter will determine whether they ship — and whether the next contributor after them shows up at all. Recording the conceptual shape early prevents accidentally shipping an authoring experience that retains nobody.

## The shape, in one paragraph

A `npx create-v1-template` scaffolder produces a working template that renders end-to-end before the author writes a line. A watch-mode bundler hot-reloads changes into a local preview. Docs follow Diátaxis — tutorial first, then reference, how-to, explanation. Community lives on a searchable forum (Discourse or GitHub Discussions) with optional Discord for vibes, not support. The platform-team relationship is governed by a stability promise, a "proposed" API tier, and machine-readable deprecation markers. WeatherV1 ships as the reference template every contributor reads. Supply-chain defences (signed publishes, no postinstall, namespace reservation) are present from day one. Author monetisation is sidecar (Stripe, Gumroad), not platform-built.

## Scaffolding: clone, npm install, watch

VS Code's `yo code` Yeoman generator produces a TypeScript-or-JS extension that opens in the Extension Development Host in under five minutes; Obsidian's "Use this template" on `obsidian-sample-plugin` plus `npm run dev` (esbuild watch) is similarly minimal; Figma offers `create-figma-plugin` and Plugma (Vite-based) as community improvements over the official quickstart ([VS Code — first extension](https://code.visualstudio.com/api/get-started/your-first-extension), [Obsidian — build a plugin](https://docs.obsidian.md/Plugins/Getting+started/Build+a+plugin), [Create Figma Plugin](https://yuanqing.github.io/create-figma-plugin/)).

The pattern across all three is the same: **generator command + watch-mode bundler + a sample that runs unmodified**.

For V1: `npx create-v1-template` should produce a template that produces a working render before the author writes a line.

## Hot-reload: the difference between "experiment" and "edit-restart-curse"

Obsidian's ecosystem famously routes around the platform's missing hot-reload via PJ Eby's third-party Hot-Reload plugin that watches `main.js` / `styles.css` for any plugin with a `.git` dir or `.hotreload` marker — its existence (and adoption) is a lesson that **authors *will* build the missing inner loop themselves if we don't** ([pjeby/hot-reload](https://github.com/pjeby/hot-reload)). Shopify CLI's `shopify theme dev` hot-reloads CSS and sections to a live preview URL ([Shopify — theme dev](https://shopify.dev/docs/storefronts/themes/getting-started/create)).

**Plan a watch-and-replan loop from day one.** A template author should edit the brief, save, and see the next scene re-planned within seconds.

## Docs: Diátaxis, tutorial-first

The Diátaxis framework splits docs into Tutorial / How-To / Reference / Explanation by the user's posture (learning vs. working, practical vs. theoretical) ([Diátaxis](https://diataxis.fr/)). Astro and SvelteKit both lead with a guided "build a blog/app" tutorial before reference. Sequin's post-mortem of restructuring their docs around Diátaxis is a useful case study — the change marked the moment docs stopped "describing the API" and started "onboarding humans" ([Sequin — Diátaxis](https://blog.sequinstream.com/we-fixed-our-documentation-with-the-diataxis-framework/)).

**Tutorial-first is the right default for an author-recruiting doc set.**

## "First template in 15 minutes" is a load-bearing metric

Time-to-Hello-World (TTHW) has been a DX north-star metric for decades because it's a measurable proxy for everything else — install ergonomics, doc clarity, error messages, sample quality. APIscene argues the first five minutes should be treated as a **product** problem, not a docs problem; vendors that win the first five minutes win developer LTV ([The CTO's Edge — TTHW](https://www.thectosedge.com/insights/time-to-hello-world/), [APIscene — TTHW and developer LTV](https://www.apiscene.io/dx/time-to-hello-world-and-the-journey-to-developer-ltv/)).

**Instrument it.** Time from "clone" to "scene renders in preview" on a freshly provisioned machine, tracked per release. Anything over 15 minutes is a regression.

## Forum beats Discord for durable knowledge; Discord wins for vibes

Obsidian deliberately runs both: Discord for casual chat and plugin announcements; Discourse forum for long-form questions, feature requests, and security disclosure. **Google can't index Discord**, so every Discord-only answer is re-asked weekly — the "same question every day" phenomenon ([Obsidian — future of plugins](https://obsidian.md/blog/future-of-plugins/), [Building community in Obsidian](https://robhaisfield.com/notes/building-community-in-obsidian-with-licat), [Dan Moore — forums over Slack/Discord](https://www.mooreds.com/wordpress/archives/3451), [Discord Is Killing Programming Communities](https://medium.com/@sohail_saifii/discord-is-killing-programming-communities-and-heres-the-proof-4f44d8a4f2bf)).

**Pragmatic advice: start with a forum (Discourse, GitHub Discussions) for searchable Q&A. *Delay* Discord until you have moderation capacity.** Discord without moderators becomes a support black hole; a quiet forum thread is still a Google result.

## Contributor metrics: track retention, not raw counts

The Open Source Contributor Index distinguishes "Active Contributors" (≥10 commits) from "Total Community" (≥1) because **~58% of first-time contributors in DB-repo cohorts make 1–2 commits and vanish** ([EPAM — OSCI](https://solutionshub.epam.com/blog/post/introducing-osci-what-you-need-to-know-about-the-open-source-contributor-index), [Runa Capital — OSS contributors analysis](https://medium.com/runacapital/open-source-analysis-and-os-databases-1eb1fe840719)).

Useful authoring-ecosystem metrics:
- **MAU of the authoring CLI.**
- **% of published templates updated in the trailing 90 days** — a "freshness" proxy that catches abandonment early.
- **30-day retention of new contributors.**
- **DAU / MAU as an engagement ratio.**

**Publish them quarterly — transparency itself attracts contributors.**

## Showcases pull contributors in, but go stale fast

Vercel Templates, Next.js Showcase, Strapi Showcase, and Framer's gallery all function as both proof-of-quality and pattern library for new authors ([Vercel Templates](https://vercel.com/templates), [Next.js Showcase](https://nextjs.org/showcase), [Strapi Showcase](https://strapi.io/showcases)). The trap, visible across all of them, is **staleness** — a showcase entry from a deprecated API version actively misleads.

**Defences:** automated "last verified" stamps, a CI job that re-renders showcase templates on every platform release, and a quiet sunset policy for entries that fail.

## Reference implementation as teaching tool

Strapi's `strapi-examples` repo and `strapi-template-blog` exist precisely to show "what good looks like" in a runnable form; Next.js's `examples/` folder is famously the way most contributors learn idioms ([strapi-examples](https://github.com/strapi/strapi-examples), [Strapi templates docs](https://docs.strapi.io/cms/templates)).

**WeatherV1 itself should be packaged as *the* reference template** — versioned alongside the platform, used in CI as the smoke test, explicitly cited from tutorials as "open this in your editor and read it". This is the operational expression of the "WeatherV1 as inaugural template" framing in [`TEMPLATES.md`](TEMPLATES.md).

## Platform-author relationship: explicit deprecation contracts

VS Code's stance is unusually disciplined: a public "Extension API guidelines" wiki, a **Proposed API channel gated to Insiders** so unstable APIs can't leak into published extensions, and a long-standing commitment to *not* break shipped extensions even when APIs are marked deprecated. The 1.68 release added in-marketplace **deprecation labels** so authors can hand off retired extensions visibly ([VS Code — Extension API guidelines](https://github.com/microsoft/vscode/wiki/Extension-API-guidelines), [VS Code — proposed API](https://code.visualstudio.com/api/advanced-topics/using-proposed-api), [VS Code 1.68 deprecation labels](https://www.infoworld.com/article/2335656/visual-studio-code-168-identifies-deprecated-extensions.html)).

**Adopt the same pattern:** a written stability promise, a "proposed" tier, machine-readable deprecation markers.

## Supply-chain attacks are the default, not the edge case

2025–2026 saw the September-2025 phishing-driven takeover of `chalk` / `debug` / `ansi-styles` (2.6B weekly downloads), the GlassWorm self-propagating malware family on Open VSX, the TigerJack VS Code campaign (11+ extensions), the February-2026 SANDWORM_MODE typosquat worm, and the Axios PAT-theft chain ([Unit 42 — npm threat landscape](https://unit42.paloaltonetworks.com/monitoring-npm-supply-chain-attacks/), [Help Net Security — SANDWORM_MODE](https://www.helpnetsecurity.com/2026/02/24/npm-worm-sandworm-mode-supply-cain-attack/), [Wiz — VS Code marketplace risk](https://www.wiz.io/blog/supply-chain-risk-in-vz-code-extension-marketplaces), [Dark Reading — GlassWorm](https://www.darkreading.com/application-security/fresh-glassworm-vs-code-extensions-supply-chain)).

**Lightweight defences appropriate to a small ecosystem:**
- Namespace-reserve common typos at launch.
- Require signed publishes.
- Forbid `postinstall` scripts in templates.
- Lock unmaintained-author handles against resale.
- Publish a security-disclosure email *before* you need one.

## Author monetisation: payment plumbing, not platform-built

Even if the platform takes a 0% cut (the position [`PRODUCT_DIRECTION.md`](PRODUCT_DIRECTION.md) currently leans toward), **authors care about payment plumbing**. Microsoft has resisted paid-marketplace extensions for years; the workaround is the `sponsor` field in `package.json` (renders a Sponsor button) plus selling licences off-marketplace via Stripe / Gumroad / Dodo ([VS Code — sponsor field](https://github.com/microsoft/vscode-discussions/discussions/14), [VS Code — monetize extensions issue](https://github.com/microsoft/vscode/issues/111800)).

Stripe Connect is the standard for marketplaces but carries real friction — three account types, KYC/KYB, country restrictions, platform tax liability ([Greenmoov — Stripe Connect 2026 guide](https://greenmoov.app/articles/en/stripe-connect-for-marketplace-payments-explained-account-types-onboarding-and-pricing-2026-guide)). Gumroad is the low-friction first option: 30-minute setup, 85% of its GMV is digital downloads averaging $47 ([Gumroad for digital products 2026](https://mydesigns.io/blog/gumroad-for-selling-digital-products/)).

**Document both paths; don't build payments; don't pretend authors don't care.**

## Design tensions worth flagging now

- **Curated vs. open authorship.** Marketplace shape lives in [`PRODUCT_DIRECTION.md`](PRODUCT_DIRECTION.md), but ecosystem DX has to land somewhere on that spectrum from day one.
- **Stability promise scope.** A strong promise (no breaks ever) constrains the platform; a weak one (we deprecate freely) thins the ecosystem.
- **Proposed API tier.** Powerful for fast iteration; doubles the API surface area to test and document.
- **Discord-or-not.** Discord pulls energy in but produces no durable knowledge. The right answer depends on team capacity to moderate.
- **Sponsor button vs. paid marketplace.** Sponsor is friction-light but unserious; paid marketplace is serious but a separate product to operate.
- **Reference-template visibility.** Cite WeatherV1 as the "read this" example everywhere = clarity. Privilege it at runtime = surprising for authors.
- **Author identity model.** GitHub username (light, leaky), platform account (heavier, real), DID/cryptographic (heaviest, future-facing).

## Open questions

- Do templates ever go external, and if so under what gate (invite-only, application, open)?
- Who owns the forum if there is one — the platform team, a community DAO, a contractor?
- Is the authoring CLI a separate tool, a mode of the main app, or both?
- How do we make WeatherV1's full source readable as a teaching artefact without coupling its lifecycle to the platform's?
- Does the ecosystem support both Hebrew-authored and English-authored templates from day one, or English-first?

## Relationship to other future work

- [`TEMPLATES.md`](TEMPLATES.md) — what the author is building.
- [`PRODUCT_DIRECTION.md`](PRODUCT_DIRECTION.md) — whether external authorship happens at all, and on what economic terms.
- [`DISTRIBUTION.md`](DISTRIBUTION.md) — publishing, signing, version visibility from the author's side.
- [`QUALITY_AND_EVAL.md`](QUALITY_AND_EVAL.md) — what the author has to supply (rubric, golden set) for their template to ship.
- [`AI_NATIVE_PIPELINE.md`](AI_NATIVE_PIPELINE.md) — the stability promise on agent and tool surfaces.
- [`MODEL_STRATEGY.md`](MODEL_STRATEGY.md) — which model picks the author can express in their manifest.

## Non-goals

No CLI design. No forum platform choice. No commitment to a marketplace, payment system, or sponsorship programme. No claim that ecosystem work should start before WeatherV1 has proved the shape.
