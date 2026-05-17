# Vision: Product direction

> Status: vision / discovery, research-grounded. No business plan, roadmap, or pricing committed. Sibling docs: [`TEMPLATES.md`](TEMPLATES.md), [`AI_NATIVE_PIPELINE.md`](AI_NATIVE_PIPELINE.md), [`UX_DIRECTION.md`](UX_DIRECTION.md), [`QUALITY_AND_EVAL.md`](QUALITY_AND_EVAL.md), [`MODEL_STRATEGY.md`](MODEL_STRATEGY.md), [`DATA_AND_CONTENT.md`](DATA_AND_CONTENT.md), [`DISTRIBUTION.md`](DISTRIBUTION.md), [`ECOSYSTEM.md`](ECOSYSTEM.md), [`LOCALIZATION.md`](LOCALIZATION.md).

## Scope

This doc owns: **positioning, buyer, pricing, distribution channels, marketplace dynamics, competitive landscape, and the rename ("WeatherV1 → V1 AI Portal") as a product event.** The rename is owned here in full; other docs reference it but do not re-litigate it.

It does **not** cover: engineering ([`AI_NATIVE_PIPELINE.md`](AI_NATIVE_PIPELINE.md)), UX ([`UX_DIRECTION.md`](UX_DIRECTION.md)), template-author DX ([`ECOSYSTEM.md`](ECOSYSTEM.md)), release engineering ([`DISTRIBUTION.md`](DISTRIBUTION.md)).

## Why this exists

The current product is "an app that makes Hebrew weather forecasts". The implied future product is "a portal a user opens to produce a kind of short narrated video, where the kind is a template they pick". Those are different products. They have different buyers, different distribution stories, different competition, and different success measures. This doc records the positioning shifts worth being deliberate about — early, while the cost of choosing is still low.

## The shape of the product, in one paragraph

A desktop-first portal that turns a piece of narration into a finished short-form narrated video, using a template the user picked at the start of the job. WeatherV1 is the inaugural template — the proof that the shape works — and the standard against which new templates are measured. The portal sells (or distributes) the *shell + agent + reference template*; additional templates are content that travels separately. The product is local-first, the agent is in-the-loop, and the user's work never leaves their machine without an explicit gesture.

## "App → platform" only when the value built on top exceeds the value of the shell

Ben Thompson formalised Bill Gates' definition: **"A platform is when the economic value of everybody that uses it exceeds the value of the company that creates it."** Windows clears the line; Facebook's developer platform does not, because Facebook captured more value than the apps built on it ([Stratechery — The Bill Gates Line](https://stratechery.com/2018/the-bill-gates-line/)). The implication for V1: until the value created by *template authors plus end-customers* exceeds the value created by V1's first-party rendering, **the right framing is "an app with an extension surface, not a platform"** — and the marketing should reflect that.

a16z reinforces the related warning: the word "platform" is overused; a real enterprise platform is "a market-leading company with a single suite of products that gets stronger as it accumulates new data and ships new products", and constrained beats unconstrained for app-gen tools — being great at one thing first is the precondition ([a16z — Anatomy of an Enterprise Platform Company](https://a16z.com/anatomy-of-an-enterprise-platform-company/), [a16z — Batteries Included, Opinions Required](https://a16z.com/specialized-app-gen-platforms/)).

## Vertical-SaaS wedge: depth first, breadth only at scale

The vertical-SaaS playbook is well documented: (a) wedge with one acute pain point (Toast → tablet POS, ServiceTitan → dispatching, Procore → project mgmt); (b) let existing customers tell you the adjacent products; (c) layer financial services / payments; (d) only at $100M–$1B ARR open a marketplace. ServiceTitan's *second* vertical move (FieldRoutes/pest, Aspire/landscaping) was done **via acquisition with independent branding**, not by stretching one product ([Bessemer — Ten Lessons from a Decade of Vertical Software](https://www.bvp.com/atlas/ten-lessons-from-a-decade-of-vertical-software-investing); [Blume — Vertical SaaS Secret Playsheet](https://blume.vc/commentaries/the-vertical-saas-secret-playsheet-inside-gyan-from-elite-vertical-saas-companies)).

Stall mode is well-documented: founders try to sell sideways into "adjacent" verticals that look similar but aren't, and learn the hard way that customers in vertical B don't want software designed for vertical A. Successful multi-verticals "move slowly and deliberately", treating each vertical as a division ([Practical Founders — Why Multi-Vertical SaaS Companies Are Difficult to Execute](https://practicalfounders.com/articles/multi-vertical-saas-companies-difficult-execute/)).

**Read for V1: the weather template is the wedge. The second template should be deep, not broad. Expect to staff it like a small business unit, not as a config change.**

## Template economics: shell revenue dominates, by a lot

Canva is the cleanest comp: ~70–75% subscription, 15–20% print, **only 5–10% from the creator/template marketplace**, with creators keeping 65% (Canva 35%) ([Untaylored — How Canva Makes Money](https://www.untaylored.com/post/how-canva-makes-money-business-model-explained); [Sacra — Canva](https://sacra.com/c/canva/)). Figma similarly leans on seats and is now monetising AI credits, not its community marketplace ([TNW — Figma Q1 AI monetization](https://thenextweb.com/news/figma-q1-earnings-ai-monetization-stock-rebound)).

Notion templates produce real creator income (Easlo >$500k, Frank >$1M) but the *platform* doesn't take a cut; templates are a top-of-funnel demand generator for Notion seats ([Foundation — Notion Project Templates](https://foundationinc.co/lab/notion-project-templates/)). Webflow templates pay 60–80% commission but creators report ~$1,100/mo per template — viable for individuals, not a platform business ([Nikolai Bain — How Much Can You Make from Webflow Templates](https://www.nikolaibain.com/blog/how-much-can-you-make-from-webflow-templates)).

**The realistic V1 revenue mix is shell-dominated; a template marketplace is acquisition fuel, not a P&L line.**

## AI-tool business models in 2026: credits won, painfully

AI video has converged on **credit-based subscriptions with per-second/per-render economics underneath** (Kling ~$0.07/s, Sora ~$0.10/s, VEED moved from flat sub → credits in 2025) ([Magic Hour — AI Video Pricing Index 2026](https://magichour.ai/blog/ai-video-pricing-index); [CheckThat — VEED Pricing 2026](https://checkthat.ai/brands/veed/pricing)).

Cursor's June 2025 credit-pricing shift is the cautionary tale: developer trust collapsed and Windsurf became the reddit default within weeks ([Lowcode — Cursor AI Pricing 2026](https://www.lowcode.agency/blog/cursor-ai-pricing); [NxCode — Cursor AI Pricing 2026](https://www.nxcode.io/resources/news/cursor-ai-pricing-plans-guide-2026)). The friction is universal: users hate iterating against opaque credit burn.

**For V1, transparent BYOK ("you pay your own OpenAI key") sidesteps the trust loss and pairs naturally with the local-first promise.** Trade-off: zero margin to subsidise improvements, and install friction. A managed tier on top of BYOK is a credible future move, not a v1 commitment.

## Local-first as a commercial category

Obsidian is the proof point: free app, $5/mo Sync, $10/mo Publish, $50/user/yr Commercial — "100% user-supported, not investors", no telemetry, commercial license on the honour system, and >10,000 paying orgs incl. Amazon, Meta, Shopify, Capital One ([Obsidian — Pricing](https://obsidian.md/pricing)). DaVinci Resolve gives away a non-watermarked free tier and sells a **$295 perpetual** Studio licence with lifetime updates ([Blackmagic — DaVinci Resolve Studio](https://www.blackmagicdesign.com/products/davinciresolve/studio)). Ableton uses perpetual + rent-to-own, no subscription ([Ableton — License Policy](https://help.ableton.com/hc/en-us/articles/209772745-License-policy-for-Live)).

Pricing shapes compatible with a no-telemetry product: **perpetual licence, optional paid sync/cloud sidecar, honour-system commercial tier.** Not compatible: seat-tracking that requires phone-home; usage-metering that requires server-side observation.

## Competitive landscape: there is no template-first agentic local category yet

The 2026 landscape ([Zapier — Best AI Video Generators 2026](https://zapier.com/blog/best-ai-video-generator/); [HeyGen — Best AI Video Generators 2026 Tested](https://www.heygen.com/blog/best-ai-video-generators-tested-and-reviewed)):

- **Avatar tools** (Synthesia, HeyGen) own corporate L&D.
- **Descript** owns transcript-driven editing.
- **Runway** owns generative.
- **Pictory / VEED** own repurposing.
- **Captions** owns social-creator mobile.

None are template-first, local-first, *and* agent-orchestrated. That is a category-design opportunity in Lochhead's sense: name the slot before competitors do ([Lochhead — Category Creation](https://lochhead.com/category-creation-a-new-lens-on-business/)). The risk is the slot is small; the upside is undisputed ownership.

## The rename: WeatherV1 → V1 AI Portal

The rename is a positioning shift, not a technical one, and the doc that owns it is this one. The technical work it triggers (installer names, R2 paths, GitHub repo, splash, docs, download page) is mechanical; the *product question* is whether the new name is *earned* or *aspirational*.

### Earned names ship at the same moment as the new capability

The Slack rebrand worked because the *product was already loved internally* and the rebrand coincided with public launch — **name + thing arrived together** ([First Round — Slack's Epic Launch Strategy](https://review.firstround.com/from-0-to-1b-slacks-founder-shares-their-epic-launch-strategy/)). Meta is the textbook failure: HBR called out that Facebook "re-branded before its vision was a reality", adopting a name based on capabilities a decade away — confusing at best, brand-degrading at worst ([HBR — Facebook's Rebrand Has a Fundamental Problem](https://hbr.org/2021/11/facebooks-rebrand-has-a-fundamental-problem)).

**A rename must be paid for with new product, shipped at the same moment.** A 4–6 week communications ramp before the switch, customer opt-in to preview, and tight internal alignment first ([SmashBrand — Flawless Rebranding Launch](https://www.smashbrand.com/articles/rebranding-launch/)).

### Pacing: pair the rename with the second template, not before

Product-marketing consensus: rename + meaningful new capability shipped together is materially stronger than either alone, because the rename gives the press a reason to write and the new capability gives users a reason to care ([Appcues — Product Launch Examples](https://www.appcues.com/blog/product-launch-examples)).

**"We are now V1 AI Portal, and here is our second template" is the right sequence.** Renaming first and shipping the second template later is the Meta failure mode.

### "V1" as heritage or as baggage

Whether "V1" stays in the new name is a strategic call. Heritage argument: it preserves continuity with existing users, suggests "first version of a category", carries internal pride. Baggage argument: it signals "still version 1" to outsiders, may date badly, requires explaining. **Mixed signalling — "V1" in some surfaces, dropped in others — is the worst outcome.**

## Marketplace operations: almost everyone regrets going open early

Curated marketplaces hit ~92% customer satisfaction vs. 84% for open; open marketplaces incur outsized fraud, fake-goods, and moderation costs that scale super-linearly and burn out human reviewers ([Marketplacer — Curated vs Open Marketplaces](https://marketplacer.com/blog/curated-vs-open-marketplace/); [GetStream — Marketplace Content Moderation](https://getstream.io/blog/marketplace-content-moderation/)). Apple's hybrid (human + automated review) is the operating-cost benchmark.

**For V1: if templates ever go external, start partner-only / invite-only. Defer the open marketplace until the second-template generation has shaken out the abuse surface.** Template-author DX, regardless of marketplace shape, lives in [`ECOSYSTEM.md`](ECOSYSTEM.md).

## What stays invariant

- **Local-first.** The product's defining promise — the user's media and work stay on their machine — does not change as the surface grows.
- **Single-tenant.** The product is not a hosted SaaS. R2 is a sidecar for distribution and sync, not a multi-tenant data store.
- **Desktop is the primary runtime.** The web build is a development surface, not an end-user deployment target.
- **The renderer remains ffmpeg on the user's machine.** No cloud rendering.
- **The product is opinionated about quality.** "Make any video" is not the pitch; "make *this kind of video well*" is.

## Design tensions worth flagging now

- **Who is the buyer.** End producer, their employer (broadcaster / marketing team / school), or a template author selling into the platform.
- **Pricing surface.** Per seat / per render / per template installed / free-shell-paid-templates / services-around-it. Each picks different winners.
- **Open vs. curated templates.** Anyone authors + publishes (growth, brand risk) vs. partner-built only (slower, higher quality).
- **Brand of the templates.** Does a template carry V1's brand, the author's, the end producer's — or all three layered?
- **Rename's product weight.** Cosmetic rename = cheap. Product rename = a launch. Treating the second as the first is a known failure mode.
- **Distribution mix.** Today: GitHub release + R2 + download page. Tomorrow: a template gallery? A web onboarding? Each new channel adds operational cost.
- **Geography and language.** Hebrew-first with English templates as second class, English-first with Hebrew as a template, or bilingual at the shell. Each implies different marketing surfaces.
- **Pacing of rename vs. second template.** Same week = coordination cost. Rename first = unearned. Second template first = rename arrives without the moment.

## Open questions

- Is the product sold, given away, open-sourced, or kept internal?
- Who is the second template's intended buyer — and does that buyer exist in numbers that justify building a multi-template product at all?
- Is the rename a cosmetic rename or a product launch — and is the team set up to run the latter?
- Does the product grow a web tier, or does desktop-only stay the bet?
- Is there a template marketplace in the long run, and if so, what do we curate vs. what do we accept?
- How does pricing interact with the local-first invariant — usage-based pricing usually wants telemetry the local-first promise discourages?
- Does "V1" stay in the new name, and what is the migration story for existing installs / download URLs?

## Relationship to other future work

- [`TEMPLATES.md`](TEMPLATES.md) — what the shell is built *around*.
- [`AI_NATIVE_PIPELINE.md`](AI_NATIVE_PIPELINE.md) — what makes the shell defensible as more than "an installer plus prompts".
- [`UX_DIRECTION.md`](UX_DIRECTION.md) — what the buyer actually sees on day one.
- [`DISTRIBUTION.md`](DISTRIBUTION.md) — the release-engineering side of any rename / marketplace move.
- [`ECOSYSTEM.md`](ECOSYSTEM.md) — author DX, which marketplace operations depend on.
- [`MODEL_STRATEGY.md`](MODEL_STRATEGY.md) — BYOK vs. managed is the operational shape of the pricing decision.

## Non-goals

No pricing decision. No market sizing. No commitment to a specific second template, partner, or launch date. No commitment that the product will ever be sold rather than internally used or open-sourced. No multi-tenant SaaS framing — single-tenant invariant stays.
