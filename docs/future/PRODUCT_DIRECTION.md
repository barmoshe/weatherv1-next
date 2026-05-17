# Vision: Product direction for V1 AI Portal

> Status: vision / discovery. No business plan, no roadmap, no pricing committed in this doc — only the product-level shifts worth thinking through before the rename and the templates work entrench a particular positioning. Sibling docs: [`TEMPLATES.md`](TEMPLATES.md), [`AI_NATIVE_PIPELINE.md`](AI_NATIVE_PIPELINE.md), [`UX_DIRECTION.md`](UX_DIRECTION.md).

## Why this exists

The technical direction (multi-template, agentic, AI-native) and the rename ("WeatherV1 → V1 AI Portal") together imply a product shift, not just a renaming exercise. The current product is "an app that makes Hebrew weather forecasts". The implied future product is "a portal a user opens to produce a kind of short narrated video, where the kind is a template they pick". Those are different products. They have different buyers, different distribution stories, different competition, and different success measures. This doc records the positioning shifts worth being deliberate about — early, while the cost of choosing is still low.

## The shape of the product, in one paragraph

A desktop-first portal that turns a piece of narration into a finished short-form narrated video, using a template the user picked at the start of the job. WeatherV1 is the inaugural template — the proof that the shape works — and the standard against which new templates are measured. The portal sells (or distributes) the *shell + agent + reference template*; additional templates are content that travels separately, on a timeline the operator controls. The product is local-first, the agent is in-the-loop, and the user's work never leaves their machine without an explicit gesture.

## Shifts worth designing for

- **From "the Hebrew weather forecast tool" to "a video portal whose first template is Hebrew weather".** The category the product competes in changes. Today it's adjacent to weather-broadcast software. Tomorrow it's adjacent to AI video tools, template-driven creative platforms, and short-form production stacks.
- **From "one buyer (a weather producer)" to "many buyers, one shell".** Each template implies its own buyer: weather producers, readiness officers, educators, marketers, in-house comms teams. The shell is the unit sold; the templates are the unit bought into.
- **From "downloaded installer" to "installer + template distribution".** A weather-only product only needs one distribution channel: the installer. A multi-template product needs a second: how do templates reach users — bundled, downloaded in-app, side-loaded, marketplace?
- **From "we build the product" to "we build the platform and partner on the templates".** A second template is plausibly built in-house. A tenth is plausibly built by an outside editor with domain expertise. The relationship with template authors becomes part of the product.
- **From "free internal tool" to "something with a pricing model".** Today there is no price. A multi-template, multi-tenant-like product has natural pricing surfaces (per template, per seat, per render, per template-publish), each with different incentives.
- **From "shipping the next feature" to "shipping the next template".** The unit of product progress changes. New depth in WeatherV1 is improvement; the *second* template existing at all is the qualitative milestone.

## What stays the same

- Local-first. The product's defining promise — that the user's media and work stay on their machine — does not change as the surface grows.
- Single-tenant. The product is not a hosted SaaS. R2 is a sidecar for distribution and sync, not a multi-tenant data store.
- Desktop is the primary runtime. The web build is a development surface, not a deployment target for end users.
- The renderer remains ffmpeg on the user's machine; no cloud rendering.
- The product is opinionated about quality. "Make any video" is not the pitch; "make *this kind of video well*" is.

## Design tensions worth flagging now

- **Who is the buyer.** End producer (the person making the video), their employer (a broadcaster, a marketing team, a school), or a template author selling into the platform. Each implies different distribution, pricing, and support shapes.
- **Pricing surface.** Per seat (predictable, low friction), per render (aligns with cost but punishes iteration), per template installed (encourages template breadth), free shell + paid templates (marketplace-shaped), free everything + services around it (consulting model). Each picks different winners.
- **Open vs. curated templates.** Anyone can author and publish a template (more growth, more brand risk) vs. a curated set of partner-built templates (slower, higher quality). Hybrid models exist but are harder to operate than they look.
- **Brand of the templates.** Does a template carry the V1 AI Portal brand, the template author's brand, the end producer's brand — or all three layered? Affects how the rendered output looks and who gets credit.
- **The rename's product weight.** A pure cosmetic rename (same product, new name) is cheap. A product rename (new positioning, new audience, new marketing) is a launch. Treating the rename as the former when it's actually the latter is a known failure mode.
- **Distribution mix.** Today: downloads via R2 + a download page + a pitch deck. Tomorrow: also a template gallery? A web onboarding? A SaaS-shaped trial? Each new channel adds operational cost.
- **Geography and language.** WeatherV1 is Hebrew, Israel-shaped. The portal's positioning has to choose: Hebrew-first with English templates as second class, English-first with Hebrew as a template, or genuinely bilingual at the shell layer. Each implies different marketing surfaces.
- **Pacing of the rename vs. the second template.** Rename first → the new name is unearned ("portal" with one template inside). Second template first → the rename is delayed past the moment it would have set context. Same week → high coordination cost.
- **Competitive narrative.** The closest references today are AI video tools (Descript, Captions, Veed) and broadcast-graphics products. We are neither. The product story has to make that visible without sounding like a mash-up.

## Relationship to other future work

- [`TEMPLATES.md`](TEMPLATES.md) — what we sell / distribute the shell *around*. The product question is *who picks templates and why*; that doc is *what a template is*.
- [`AI_NATIVE_PIPELINE.md`](AI_NATIVE_PIPELINE.md) — what makes the shell defensible as more than "an installer plus prompts". The product story leans on the agent doing real work; that doc is the engineering side.
- [`UX_DIRECTION.md`](UX_DIRECTION.md) — what the buyer actually sees on day one. The product positioning sets the audience; the UX serves it.

## Non-goals for this doc

No pricing decision. No market sizing. No commitment to a specific second template, partner, or launch date. No commitment that the product will ever be sold rather than internally used or open-sourced. No multi-tenant SaaS framing — the single-tenant invariant stays. No claim that the current "free internal tool" positioning is wrong for today — only that the rename and the templates work will surface the question whether we like it or not.

## Open questions

- Is the product sold, given away, open-sourced, or kept internal?
- Who is the second template's intended buyer — and does that buyer exist in numbers that justify building a multi-template product at all?
- Is the rename a cosmetic rename or a product launch — and is the team set up to run the latter?
- Does the product grow a web tier, or does desktop-only stay the bet?
- Is there a template marketplace in the long run, and if so, what do we curate vs. what do we accept?
- How does pricing interact with the local-first invariant — usage-based pricing usually wants telemetry the local-first promise discourages?
