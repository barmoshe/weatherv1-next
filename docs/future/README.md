# Future Work

Planned but un-shipped docs. Each is self-contained (Goal / Plan / Verification). When a task ships, move its file to [`../archive/`](../archive/) and update [`../DOCS_INDEX.md`](../DOCS_INDEX.md).

| Doc | Summary |
| --- | --- |
| [MANUAL_UPDATE_CHECK.md](MANUAL_UPDATE_CHECK.md) | Replace `autoUpdater` with a manual GitHub-release check + browser open. |
| [MINIMIZE_AI_INPUT_TOKENS.md](MINIMIZE_AI_INPUT_TOKENS.md) | Cut scene-planner + picker input tokens via Anthropic cache plumbing. Bit-identical outputs. |
| [CLOUDFLARE_MCP_IMPROVEMENT_PLAN.md](CLOUDFLARE_MCP_IMPROVEMENT_PLAN.md) | Worker hardening (structured logs, rate limit, version stamp), Pulumi cleanup, MCP producer Worker. |
| [RELEASE_ASSET_STORAGE.md](RELEASE_ASSET_STORAGE.md) | _(Concluded — stub)_ Research found no infra change needed; installers ship via R2/Worker. |
| [premiere/](premiere/) | Export the planned timeline to an Adobe Premiere–importable project (FCP7 XML) + sidecar SRT, so editors can polish and render in Premiere. |
| [after-effects-graphics/](after-effects-graphics/) | _(Discovery)_ Bring V1's existing After Effects graphic layer (overlays, lower-thirds, intro/outro cards, animated weather icons) into this app. |
| [temporal/](temporal/) | _(Research)_ Integrate Temporal.io for durability, observability, and scale. Architecture, pipeline mapping, embedded-in-Electron research, idempotency convention, versioning tradeoffs, UI integration, and a Phase 1 proposal to replace the R2 mirror queue. |
| [CATALOG_TAGGING_REDESIGN.md](CATALOG_TAGGING_REDESIGN.md) | _(Research)_ Catalog tagging redesign. Failure-mode evidence, root causes (Hebrew/English split, missing subject/polarity axes), four candidate approaches, success criteria. |
| [AI_NATIVE_PIPELINE.md](AI_NATIVE_PIPELINE.md) | _(Vision)_ Three intertwined shifts: agentic pipeline, AI-native (tools over JSON), and the "WeatherV1 → V1 AI Portal" rename. Industry best practices, design tensions, open questions. |
| [TEMPLATES.md](TEMPLATES.md) | _(Vision)_ Templates as the unit of choice — self-contained production presets (catalogue + taxonomy + brief + prompts + rules + output + brand) the user picks at job start. WeatherV1 as the inaugural / reference template. Sibling to AI_NATIVE_PIPELINE.md. |
| [UX_DIRECTION.md](UX_DIRECTION.md) | _(Vision)_ Experience-layer shifts for a templates-first, agentic app: template picker as home, agent-trace UI, intervene-any-time, visible cost, per-template onboarding. Floor-vs-ceiling and confirm-gate tensions. |
| [PRODUCT_DIRECTION.md](PRODUCT_DIRECTION.md) | _(Vision)_ Product-level shifts the rename and templates imply: from a single-buyer Hebrew weather tool to a multi-template portal. Pricing surfaces, open-vs-curated templates, rename-as-launch, distribution mix, geography. |
