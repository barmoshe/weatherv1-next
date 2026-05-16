# Future Work

Planned but un-shipped docs. Each is self-contained (Goal / Plan / Verification). When a task ships, move its file to [`../archive/`](../archive/) and update [`../DOCS_INDEX.md`](../DOCS_INDEX.md).

| Doc | Summary |
| --- | --- |
| [EDITOR_AND_ADMIN_GATES.md](EDITOR_AND_ADMIN_GATES.md) | Editor login at app entry + Settings modal redesign into Editor/Admin tabs + shared Argon2id password layer. |
| [MANUAL_UPDATE_CHECK.md](MANUAL_UPDATE_CHECK.md) | Replace `autoUpdater` with a manual GitHub-release check + browser open. |
| [MINIMIZE_AI_INPUT_TOKENS.md](MINIMIZE_AI_INPUT_TOKENS.md) | Cut scene-planner + picker input tokens via Anthropic cache plumbing. Bit-identical outputs. |
| [STATIC_HOSTING.md](STATIC_HOSTING.md) | Move the pitch-deck site from GitHub Pages to Cloudflare Pages via Pulumi + `wrangler-action`. |
| [CLOUDFLARE_MCP_IMPROVEMENT_PLAN.md](CLOUDFLARE_MCP_IMPROVEMENT_PLAN.md) | Worker hardening (structured logs, rate limit, version stamp), Pulumi cleanup, MCP producer Worker. |
