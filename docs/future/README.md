# Future Work

Planned but un-shipped docs. Each is self-contained (Goal / Plan / Verification). When a task ships, move its file to [`../archive/`](../archive/) and update [`../DOCS_INDEX.md`](../DOCS_INDEX.md).

| Doc | Summary |
| --- | --- |
| [MANUAL_UPDATE_CHECK.md](MANUAL_UPDATE_CHECK.md) | Replace `autoUpdater` with a manual GitHub-release check + browser open. |
| [MINIMIZE_AI_INPUT_TOKENS.md](MINIMIZE_AI_INPUT_TOKENS.md) | Cut scene-planner + picker input tokens via Anthropic cache plumbing. Bit-identical outputs. |
| [RELEASE_ASSET_STORAGE.md](RELEASE_ASSET_STORAGE.md) | _(Concluded — stub)_ Research found no infra change needed; installers ship via R2/Worker. |
| [premiere/](premiere/) | _(Discovery)_ Export the planned timeline to an Adobe Premiere–importable project (FCP7 XML) + sidecar SRT, so editors can polish and render in Premiere. Research compares FCP7 XML vs. CEP/UXP panel vs. OTIO vs. EDL/AAF. |
| [after-effects-graphics/](after-effects-graphics/) | _(Discovery)_ Bring V1's existing After Effects graphic layer (overlays, lower-thirds, intro/outro cards, animated weather icons) into this app. |
| [temporal/](temporal/) | _(Research)_ Integrate Temporal.io for durability, observability, and scale. Architecture, pipeline mapping, embedded-in-Electron research, idempotency convention, versioning tradeoffs, UI integration, and a Phase 1 proposal to replace the R2 mirror queue. |
| [CATALOG_TAGGING_REDESIGN.md](CATALOG_TAGGING_REDESIGN.md) | _(Research)_ Catalog tagging redesign. Failure-mode evidence, root causes (Hebrew/English split, missing subject/polarity axes), four candidate approaches, success criteria. |

### V1 AI Portal vision set — separation of concerns

Ten sibling vision docs that together sketch what WeatherV1 could become as a multi-template, agent-orchestrated AI video portal. Each owns one non-overlapping concern; each is research-grounded with public-source citations. All are vision / discovery only — no implementation plans.

| Doc | Concern owned |
| --- | --- |
| [TEMPLATES.md](TEMPLATES.md) | The *concept* of a template (manifest + body + configurable surface), what's inside one, authorship models, versioning, "WeatherV1 as the reference template". |
| [AI_NATIVE_PIPELINE.md](AI_NATIVE_PIPELINE.md) | Engineering — agent patterns (Anthropic's vocabulary), tool design, OTel observability, pipeline-level evals, JSON-API-to-tools shift, cost discipline. |
| [UX_DIRECTION.md](UX_DIRECTION.md) | Experience layer — template picker, agent-trace UI, risk-tiered confirm gates, intervention, per-template onboarding, RTL+LTR shell mechanics, ambient cost. |
| [PRODUCT_DIRECTION.md](PRODUCT_DIRECTION.md) | Positioning — buyer, pricing, distribution, marketplace dynamics, competitive landscape, the rename ("WeatherV1 → V1 AI Portal") as a launch event. |
| [DATA_AND_CONTENT.md](DATA_AND_CONTENT.md) | Asset lifecycle — IPTC/C2PA rights & provenance, ingest, AI-tagging confidence bands, retention and soft delete, marketplace-with-rights-passthrough. |
| [QUALITY_AND_EVAL.md](QUALITY_AND_EVAL.md) | Editorial correctness — per-template golden sets, rubric-graded eval, reviewer calibration, ship/no-ship criteria, LLM-as-judge bias controls, regression dashboards. |
| [DISTRIBUTION.md](DISTRIBUTION.md) | Release engineering — update channels, signing/notarisation, plugin trust, delta updates, rollback, telemetry posture, launcher + on-demand modules. |
| [MODEL_STRATEGY.md](MODEL_STRATEGY.md) | Provider strategy — multi-provider abstraction, cost-tier routing, local inference, version pinning, BYOK vs. managed, per-locale voice/vision/embedding. |
| [ECOSYSTEM.md](ECOSYSTEM.md) | Template-author DX — scaffolding, hot-reload, Diátaxis docs, time-to-hello-world, forum-vs-Discord, supply-chain hygiene, author monetisation plumbing. |
| [LOCALIZATION.md](LOCALIZATION.md) | Per-locale content — transcript / voice / vision per language, taxonomies as parallel vocabularies (not translations), locale-aware prompting, bidi in burned-in captions, font licensing. |
