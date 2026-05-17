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
| [AI_NATIVE_PIPELINE.md](AI_NATIVE_PIPELINE.md) | _(Vision)_ Four intertwined shifts: multi-catalogue, agentic pipeline, AI-native (tools over JSON), and the "WeatherV1 → V1 AI Portal" rename. Industry best practices to draw on, design tensions, open questions. |
