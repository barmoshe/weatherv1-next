# Vision: Data and content lifecycle

> Status: vision / discovery, research-grounded. No code or schema proposed. Sibling docs: [`TEMPLATES.md`](TEMPLATES.md), [`AI_NATIVE_PIPELINE.md`](AI_NATIVE_PIPELINE.md), [`UX_DIRECTION.md`](UX_DIRECTION.md), [`PRODUCT_DIRECTION.md`](PRODUCT_DIRECTION.md), [`QUALITY_AND_EVAL.md`](QUALITY_AND_EVAL.md), [`MODEL_STRATEGY.md`](MODEL_STRATEGY.md), [`DISTRIBUTION.md`](DISTRIBUTION.md), [`ECOSYSTEM.md`](ECOSYSTEM.md), [`LOCALIZATION.md`](LOCALIZATION.md). Downstream of [`CATALOG_TAGGING_REDESIGN.md`](CATALOG_TAGGING_REDESIGN.md); not blocking it.

## Scope

This doc owns the **asset lifecycle**: where footage comes from, how rights are tracked, how clips are ingested and tagged, how they're retained or deleted, and how provenance survives an AI-assisted edit.

It does **not** cover: how a template *uses* its catalogue (that's the template concept — [`TEMPLATES.md`](TEMPLATES.md)), how the catalogue is presented to the user ([`UX_DIRECTION.md`](UX_DIRECTION.md)), how tagging *quality* is measured ([`QUALITY_AND_EVAL.md`](QUALITY_AND_EVAL.md)), or how authored templates package their bundled assets ([`ECOSYSTEM.md`](ECOSYSTEM.md)).

## Why this exists

Catalogues are the platform's most valuable asset: long-lived, expensively-tagged, often licensed, and increasingly carrying provenance signals from AI-assisted work. The current catalogue grew organically and the rights/retention/provenance story is implicit. As soon as a second template exists — or templates ever ship assets to or from external parties — the implicit story becomes a liability. This doc records the conceptual lifecycle and the public-evidence patterns to lean on, so the explicit story can be designed deliberately when the time comes.

## The lifecycle, in one paragraph

Footage enters the catalogue with a known source, a known licence, a known provenance, and a minimum of technical metadata. It accrues descriptive tagging asynchronously — partly automated, partly reviewed. It is referenced by jobs whose renders are recorded with the source-clip set they used. When it leaves (deletion request, licence expiry, archival), the *reference* is broken cleanly without breaking the historical render's audit trail. The catalogue is local-first; the lifecycle survives that.

## Rights model: embedded + manifest, editorial vs. commercial as a hard split

The de-facto interchange schema for rights data is **IPTC Photo/Video Metadata Hub**, and it is already AI-aware. The 2025.1 release adds four AI-specific properties (`AI Prompt Information`, `AI Prompt Writer Name`, `AI System Used`, `AI System Version Used`); Video Metadata Hub v1.6 adds rights-usage terms plus generative-AI fields ([IPTC 2025.1](http://www.iptc.org/std/photometadata/specification/IPTC-PhotoMetadata-2025.1.html), [IPTC Video Metadata Hub](https://iptc.org/std/videometadatahub/userguide/)).

For a local-first catalogue the practical pattern: **embed IPTC/XMP in the asset sidecar (so the file is self-describing if it leaves the catalogue) and keep a separate JSON manifest for rights that change over time** (subscription state, per-template grants). The embedded copy is ground truth; the manifest is the cache.

**Editorial vs. commercial is a hard split that the picker UX must surface, not bury.** Adobe Stock and equivalents draw a bright line: assets with recognisable people require a signed model release to be "commercial"; editorial assets carry a mandatory IPTC credit-line and may not be used commercially at all ([Adobe Stock licensing](https://helpx.adobe.com/stock/help/usage-licensing.html)). **A template that auto-picks an editorial clip into a brand video is a rights bug, not a styling bug** — picker rules should treat the editorial flag as a hard filter.

## Royalty-free is a usage model, not a permanence guarantee

Artgrid's "downloaded-during-subscription = lifetime use" pattern is the right precedent for a desktop app: worldwide perpetual rights to clips downloaded during an active subscription, with the restriction being "must be part of a larger creative project, no reselling as standalone" ([Artgrid Licence](https://cdn.artgrid.io/footage-images/LicenseAgreement.pdf)). **Capture the licence snapshot at ingest time; never re-evaluate it against live subscription state at render time.**

Rights-managed clips, which can expire by use, size, duration, or medium ([Sheridan copyright guide](https://sheridancollege.libguides.com/copyrightandfilms/licensedmaterials)), need the opposite — per-clip expiration metadata and a render-time check.

## Provenance: C2PA is mature enough to use, not to experiment with

C2PA membership crossed 6,000 with Google, Meta, OpenAI, Sony, Nikon, and Leica on board; Samsung Galaxy S25 and Google Pixel 10 sign every photo at capture with hardware-backed keys; Sony's PXW-Z300 extends this to professional video; BBC News embeds credentials on published images; OpenAI signs DALL·E 3 output and has committed to signing Sora video ([C2PA in 2026 — Truescreen](https://truescreen.io/articles/c2pa-standard-history-limitations/), [OpenAI joins C2PA](https://c2pa.org/openai-joins-c2pa-steering-committee/)).

What C2PA gives that IPTC/EXIF don't: a cryptographically signed, tamper-evident chain of edits — relevant the moment an AI-assisted picker or render touches the asset. **For a video tool, the unit to sign is the rendered output plus its source-clip manifest; the catalogue itself can store inbound C2PA claims as opaque blobs.**

## Ingest: minimal metadata up-front, derive the rest async

Mature MAMs (Iconik, CatDV, EditShare Flow) converge on the same shape: at ingest, capture **technical metadata** (codec, frame-accurate proxies, checksum) and **provenance** (source, ingest time, operator); derive **descriptive** tags later, asynchronously, often via AI ([Iconik — DAM vs MAM](https://www.iconik.io/blog/dam-vs-mam), [Fast.io — MAM guide 2026](https://fast.io/resources/media-asset-management-software/)). **Invariant: never block ingest on tagging.**

## AI tagging: confidence-banded review, not blind trust

The dominant 2026 pattern is **two-threshold routing**: above ~90% confidence auto-approve, 70–90% goes to a review queue, below 70% auto-reject with explanation; thresholds tuned to domain risk and review capacity. Inter-annotator agreement (IAA) is the headline metric for reviewer quality ([Mavik Labs 2026](https://www.maviklabs.com/blog/human-in-the-loop-review-queue-2026/), [Veritone metadata tagging](https://www.veritone.com/blog/metadata-tagging/)). Logging human overrides becomes the training signal that lets the auto-approve band widen over time.

## Controlled vocabularies + free text, not one or the other

Getty's Art & Architecture Thesaurus and the public "Keyword Guide" exist precisely because free-form tags collapse at the long tail — the same concept ends up under a dozen synonyms and search recall craters ([Getty Vocabularies overview](https://www.getty.edu/research/tools/vocabularies/intro_to_vocabs.pdf), [Springer — DAM thesaurus paper](https://link.springer.com/article/10.1057/palgrave.dam.3650074)). For a small catalogue, **a hybrid wins: short controlled vocabulary for axes the picker reasons over (subject, mood, shot-type), free text for everything else.** This is the design space [`CATALOG_TAGGING_REDESIGN.md`](CATALOG_TAGGING_REDESIGN.md) is exploring.

## Retention: archival tiers vs. right-to-deletion

S3 Glacier Deep Archive has a 180-day minimum storage charge and supports Object Lock in Compliance mode, where even root cannot delete before retention expires ([AWS Glacier docs](https://docs.aws.amazon.com/AmazonS3/latest/userguide/archival-storage.html)). **That immutability is the opposite of GDPR Article 17.** The standard reconciliation is **tombstoning** the asset reference while keeping a cryptographic proof of prior existence.

For historical renders, the sane pattern: deletion removes the source clip and re-keyability but preserves a hash-only record so old renders don't break their provenance chain.

## Soft delete: default, but with a TTL and a cascade

Soft delete preserves referential integrity when historical renders point at clips. But it routinely produces "active children of deleted parents" bugs and forces every query to filter on a deletion flag forever ([brandur.org — soft deletion](https://brandur.org/soft-deletion), [Bemi — soft-deleting chaos](https://blog.bemi.io/soft-deleting-chaos/)). **Mitigation: two-stage lifecycle. Soft-delete with a TTL; hard-delete after the TTL plus a cascade check; never let the picker surface soft-deleted clips.**

## Marketplace-with-rights-passthrough: the NLE precedent

The Adobe Stock and Pond5 panels in Premiere Pro let the user search and drop a stock asset directly into the timeline; the licence is bound to the user's account, not the project, and the watermarked "preview" version is replaced on licence purchase ([Adobe Stock in Premiere](https://helpx.adobe.com/premiere/desktop/edit-projects/intro-to-editing/use-built-in-adobe-stock.html), [Pond5 Premiere panel](https://nofilmschool.com/2017/06/pond5-launches-premiere-panel-faster-stock-footage-integration)).

**Analogue for a template-author model:** templates ship with *references* plus a *watermarked low-res preview*; the user's account resolves them to licensed full-res at render time. **Never ship the full-res asset inside the template bundle** — that breaks the rights chain.

## Documented failure modes (almost all are rights confusion)

- **Carol Highsmith vs. Getty (2016)** — Getty sold "licences" for images Highsmith had donated to the Library of Congress, and even sent demand letters to people using them legitimately ([Getty Images — Wikipedia](https://en.wikipedia.org/wiki/Getty_Images)).
- **Drew Northup HIV-ad case** — editorial photo of a healthy person used in an HIV-positive ad. The canonical "editorial used as commercial" disaster ([Lexology](https://www.lexology.com/library/detail.aspx?g=a01c793c-67d9-4dd7-a8d1-7c5c51241534)).
- **Shutterstock vs. FTC** — settled $35M over deceptive subscription and cancellation practices ([FTC — Shutterstock case](https://www.ftc.gov/legal-library/browse/cases-proceedings/shutterstock-inc)).

The common thread: **provenance was lost between ingest and downstream use, and there was no machine-checkable licence assertion travelling with the asset.** Exactly the gap C2PA + embedded IPTC + a per-clip licence manifest is designed to close.

## Design tensions worth flagging now

- **Embedded vs. external rights data.** Embedded survives the file leaving the catalogue but can lie; external is authoritative but can drift.
- **Editorial / commercial as hard filter vs. user choice.** Hard filter prevents the rights bug; user choice respects user expertise.
- **AI-tagging trust threshold.** Tight = more reviewer load; loose = silent tagging drift.
- **Soft-delete TTL.** Long = the catalogue accretes ghosts; short = users lose recovery time.
- **C2PA signing surface.** Sign each clip individually (heavy) vs. sign the render's manifest (light) vs. both.
- **Catalogue ownership in marketplace templates.** Bundled (heavy, rights-fragile), referenced (light, runtime-dependent), or per-user-supplied (lightest, friction-heaviest).
- **Long-tail storage cost vs. retention promise.** A "we never lose your footage" promise is a meaningful unbounded liability over years.

## Open questions

- Is the catalogue a per-template artefact, a per-user library, or both?
- Do we adopt C2PA now or wait for ecosystem maturity to settle further?
- How do we surface rights status in the picker — chip, banner, hard filter, or "you'll see it at render time"?
- Should rights-managed clips with expiration ever enter the catalogue at all, or only royalty-free / perpetual?
- Where do AI-applied tags vs. human-reviewed tags vs. human-authored tags get marked, and does the user see the difference?

## Relationship to other future work

- [`TEMPLATES.md`](TEMPLATES.md) — what a template *contains* of the catalogue (manifest, references, bundled clips).
- [`CATALOG_TAGGING_REDESIGN.md`](CATALOG_TAGGING_REDESIGN.md) — the tag schema this lifecycle feeds.
- [`QUALITY_AND_EVAL.md`](QUALITY_AND_EVAL.md) — how the *quality* of tagging and picking is measured.
- [`UX_DIRECTION.md`](UX_DIRECTION.md) — how rights/availability/provenance status appears in the catalogue browser.
- [`MODEL_STRATEGY.md`](MODEL_STRATEGY.md) — which vision/embedding model does the auto-tagging.
- [`PRODUCT_DIRECTION.md`](PRODUCT_DIRECTION.md) — marketplace operations, which depend on this lifecycle being clean.

## Non-goals

No file format. No proposed schema. No commitment to adopt C2PA, Glacier, or any specific vendor. No multi-tenant SaaS framing — single-tenant invariant stays.
