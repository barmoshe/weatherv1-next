# Vision: Distribution and release engineering

> Status: vision / discovery, research-grounded. No CI config or installer changes proposed. Sibling docs: [`TEMPLATES.md`](TEMPLATES.md), [`AI_NATIVE_PIPELINE.md`](AI_NATIVE_PIPELINE.md), [`UX_DIRECTION.md`](UX_DIRECTION.md), [`PRODUCT_DIRECTION.md`](PRODUCT_DIRECTION.md), [`QUALITY_AND_EVAL.md`](QUALITY_AND_EVAL.md), [`MODEL_STRATEGY.md`](MODEL_STRATEGY.md), [`DATA_AND_CONTENT.md`](DATA_AND_CONTENT.md), [`ECOSYSTEM.md`](ECOSYSTEM.md), [`LOCALIZATION.md`](LOCALIZATION.md).

## Scope

This doc owns **release engineering for shell + templates**: update channels, code signing & notarisation, plugin/template trust, delta vs. full updates, rollback, telemetry posture, installer shape (single-bundle vs. launcher + on-demand), object-storage distribution backend, and per-platform release pacing.

It does **not** cover: marketplace economics ([`PRODUCT_DIRECTION.md`](PRODUCT_DIRECTION.md)), template-author tooling ([`ECOSYSTEM.md`](ECOSYSTEM.md)), the template concept itself ([`TEMPLATES.md`](TEMPLATES.md)), or assets inside templates ([`DATA_AND_CONTENT.md`](DATA_AND_CONTENT.md)).

## Why this exists

Today: single Windows installer, GitHub Actions, R2 distribution, no auto-update. Tomorrow (if templates ship): the shell and each template may need to update independently, possibly with auto-update, possibly across multiple OSes, possibly with signed user-authored content. The shape of "release engineering" changes meaningfully when there is more than one thing to release. Recording the conceptual model and the public-evidence patterns early prevents an accidental architecture.

## The shape, in one paragraph

Two independently versioned release surfaces: **the shell** (the app itself, slow-moving, signed and notarised per OS) and **templates** (signed manifests + bundled assets, faster-moving, downloadable on demand). A single named "stable channel" for normal users; an optional "insiders" build for early access. Auto-update for the shell via electron-updater on a delta-update path; on-demand template install via a launcher. Distribution backend stays R2. Telemetry stays opt-in or absent.

## Channels: layered streams, not parallel installs

electron-updater models three streams (`latest`, `beta`, `alpha`) where users on a riskier channel automatically receive everything stabler, controlled by SemVer pre-release tags plus `generateUpdatesFilesForAllChannels: true` ([electron-builder — channels](https://www.electron.build/tutorials/release-using-channels.html)). Chrome's stable/beta/dev/canary are *parallel installs* with separate user-data dirs — heavier, but lets a tester run two builds side-by-side.

**For a solo / small team, a single side-by-side "insiders" build (the VS Code pattern) is the cheapest credible answer.** Full Chrome-style four-channel parity is enterprise-scale operational overhead.

## Windows signing (2026): EV is no longer the SmartScreen story

Microsoft severed the EV → instant SmartScreen reputation link in March 2024. EV no longer skips warnings, so the historical $400–600/year EV premium is hard to justify on warning-avoidance alone ([SmartScreen reputation](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation)).

**OV cloud signing is now the cheap path:** Microsoft Trusted Signing ≈ $9.99/month; SSL.com OV from ~$100/year, EV from ~$249/year; DigiCert EV ~$581/year ([SSL.com — EV vs OV](https://www.ssl.com/faqs/which-code-signing-certificate-do-i-need-ev-ov/)). As of February 2026, standard issuance is capped at 1 year; multi-year certs require an HSM and yearly reissue.

## macOS notarisation: non-negotiable, tool-locked

Developer ID + `notarytool` upload + `stapler` is the only supported pipeline since `altool` was retired Nov 2023; Xcode 14+ required. Stapling is technically optional but mandatory in practice — without it, every cold launch hits Apple's notary servers and offline users get blocked ([Apple — notarisation docs](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution)). Membership $99/year; the operational burden is keeping app-specific passwords and signing keys in CI secrets without leaking them.

## Linux: pick one format, accept you are the package manager

For a solo team shipping an Electron app, **AppImage + electron-updater is the lowest-overhead default**: no daemon, runs from a USB stick. Flatpak gives sandboxing + a real update story via Flathub but means inheriting a runtime. Snap auto-updates and delta-downloads for free but ties you to Canonical's store ([Snap/Flatpak/AppImage comparison 2026](https://computingforgeeks.com/snap-vs-flatpak-vs-appimage/)). Pick one, document the gap, move on.

## Plugin / template trust: sandbox > review

Figma manually reviews plugins for UX, not security — they explicitly say audits produce false negatives and rely on a VM-based sandbox instead ([Figma — plugin security](https://www.figma.com/blog/an-update-on-plugin-security/)). VS Code Marketplace signs every VSIX server-side, scans for secrets and malware in a sandbox, and offers a "verified publisher" blue check that only proves domain ownership — publishers can game it by buying any domain ([VS Code marketplace security](https://developer.microsoft.com/blog/security-and-trust-in-visual-studio-marketplace)). Chrome Web Store bans obfuscation, requires per-permission justification, and signs CRX files itself.

**The lesson: review gates miss things. Signed-package + runtime sandbox is what actually holds.** For V1, if templates ever go external: signed manifests + a constrained execution surface (no arbitrary code at install time, declared capabilities, sandboxed runtime) is the correct shape.

## Delta updates: only past a clear bandwidth threshold

Chromium's Courgette (now Zucchini) hit ~0.76% patch size by disassembling x86 and diffing the instruction stream — massive engineering investment justified only by Chrome's billion-user reach ([Courgette design](https://www.chromium.org/developers/design-documents/software-updates-courgette/)). Sparkle on macOS ships `generate_appcast` producing per-version `.delta` files automatically — the small-team sweet spot ([Sparkle delta updates](https://sparkle-project.org/documentation/delta-updates/)). Squirrel.Mac is unmaintained.

**For an Electron app under ~150 MB updating monthly, full-install replacement via electron-updater is the right default.** Revisit deltas only when bandwidth or update cadence becomes painful.

## Rollback: pin a version, don't downgrade

VS Code's right-click → "Install Another Version" lets users pick any historical VSIX, then auto-update has to be turned off per-extension to keep it pinned — and known bugs still occasionally re-upgrade pre-release users ([VS Code rollback issue](https://github.com/microsoft/vscode/issues/141937)). Chrome's answer is parallel channel installs. TestFlight is forward-only.

**Real-world rollback is rare; higher-leverage investments are (a) keeping the previous installer URL alive at a stable path and (b) shipping a "revert to previous version" menu item that re-downloads it.**

## Telemetry: opt-in or none, scrubbed at the SDK boundary

Obsidian's policy is **zero app telemetry, and third-party plugins are *contractually forbidden* from collecting client-side telemetry** ([Obsidian privacy](https://obsidian.md/privacy)). Tauri ships nothing by default. Where teams want signal, Sentry's `send_default_pii=False` plus a `before_send` hook that scrubs paths, usernames, and API keys before transmission is the standard pattern; server-side scrubbing is the safety net, not the primary defence ([Sentry — scrubbing PII](https://docs.sentry.io/platforms/python/data-management/sensitive-data/)).

**For a local-first product, the credible posture is "voluntary upload of a single failed-job bundle, with a diff preview" rather than always-on telemetry.** This is the operational expression of the local-first invariant.

## Installer shape: launcher + on-demand modules for multi-template

Steam's SteamPipe splits content into ~1 MB encrypted/compressed chunks with manifests, letting DLCs install on-demand and games stream their own assets — the right reference for a shell that needs to add/update templates independently ([Steamworks DLC](https://partner.steamgames.com/doc/store/application/dlc)). Office-style monoliths force every template update through the shell release; Adobe Creative Cloud's tiny launcher + per-app downloads is the cleanest analogue for a desktop app with independently-versioned plugins.

**Build the shell installer small; treat templates as signed, downloadable manifests.** The inaugural template (WeatherV1) can ship inside the installer as the default; subsequent templates download on demand.

## R2 as distribution backend: cheap until Class A costs

R2 has zero egress and $0.015/GB-month storage; free tier covers 10 GB + 1M Class A + 10M Class B ops/month. The real bills come from **Class A operations** ($4.50/M, every PUT/multipart-init), billing rounding (1.1 GB-month rounds to 2), and missing AWS-ecosystem niceties (no native event triggers, no S3 Object Lambda) ([Cloudflare R2 pricing](https://developers.cloudflare.com/r2/pricing/)).

**For shipping installers and template bundles, R2 is essentially free at small-team scale** — but range requests + cache invalidation discipline matter once you serve multi-hundred-MB binaries.

## Per-platform pacing: automate Windows, batch Mac, defer Linux

Cross-compiling Electron with native deps doesn't work; building each target on its own runner is the only safe path ([electron-builder — multi-platform](https://www.electron.build/multi-platform-build.html)).

**Pragmatic small-team posture:**
- **Windows on every tag** in CI (cheapest runner, no notarisation round-trip).
- **macOS on local-laptop batches every N releases** (notarisation adds 2–10 min per build and needs the developer's Apple ID).
- **Linux AppImage on-demand only** when a user files an issue.

Drop "per-platform parity at every release" — replace with a published cadence ("Windows weekly, macOS monthly") and document the gap.

## Design tensions worth flagging now

- **Single channel vs. insiders channel.** Insiders gives feedback loop; doubles release surface.
- **Auto-update aggressiveness.** Background, on-launch, or user-initiated. Each has different abandonment risk.
- **Templates as bundles vs. as references.** Bundles work offline, are bigger; references work online, are lighter, fail differently.
- **Code-signing cost as fixed overhead.** ~$100–600/year before any usage. Hard to justify for an internal-only product; load-bearing for an external one.
- **Telemetry posture and the local-first promise.** A "no telemetry" pledge is a real constraint on quality-feedback loops; the trade is honest, not free.
- **Rollback granularity.** Per-template rollback is honest but multiplies the matrix; shell-only rollback is simple but blunt.
- **Launcher complexity vs. monolith simplicity.** A launcher pays for itself only past N templates; below that it's overhead.

## Open questions

- Do we adopt code-signing on macOS before there is any external distribution pressure to?
- Is there a credible "insiders" cohort of users today, or is one channel enough?
- Do we auto-update silently, or always prompt? Different posture per template vs. per shell?
- When templates exist, does each template get its own release notes / version history surface?
- How do we run the "tag triggers everything" workflow without coupling shell and template release cadence?

## Relationship to other future work

- [`PRODUCT_DIRECTION.md`](PRODUCT_DIRECTION.md) — what the distribution surface needs to support commercially.
- [`ECOSYSTEM.md`](ECOSYSTEM.md) — what the contributor experience expects of distribution (publish flow, version visibility).
- [`TEMPLATES.md`](TEMPLATES.md) — the unit being distributed.
- [`DATA_AND_CONTENT.md`](DATA_AND_CONTENT.md) — whether template assets are bundled in the install or downloaded separately.
- [`UX_DIRECTION.md`](UX_DIRECTION.md) — how update prompts, rollback, channel switching surface to the user.

## Non-goals

No specific signing cert vendor recommendation. No CI workflow proposal. No commitment to ship on Linux at all. No telemetry adoption decision. No multi-tenant SaaS framing.
