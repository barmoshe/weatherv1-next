# Archive

Historical / completed docs kept for reference. **Not** authoritative for current work — they describe shipped work, superseded designs, or one-off jobs.

| Doc | What it covers | Status |
| --- | --- | --- |
| [CATALOG_TAGGING_HANDOFF.md](CATALOG_TAGGING_HANDOFF.md) | Segment poster + Hebrew description bulk-tag pipeline | Full reference — re-read if re-segmenting (408/408 tagged) |
| [CLOUDFLARE_MCP_IMPROVEMENT_PLAN.md](CLOUDFLARE_MCP_IMPROVEMENT_PLAN.md) | Worker hardening (logs, rate limit, version stamp), Pulumi cleanup, MCP consumer + producer Worker | Plan-shaped reference — see [`../CLOUDFLARE_INTEGRATION.md`](../CLOUDFLARE_INTEGRATION.md) for live state |
| [CLOUDFLARE_R2_ELECTRON_STORAGE_PLAN.md](CLOUDFLARE_R2_ELECTRON_STORAGE_PLAN.md) | Pre-implementation R2 storage design | Stub — see [`../R2_PULUMI_HANDOFF.md`](../R2_PULUMI_HANDOFF.md) |
| [EDITOR_AND_ADMIN_GATES.md](EDITOR_AND_ADMIN_GATES.md) | Editor login + Settings Editor/Admin tabs + Argon2id | Full reference — all phases shipped |
| [ELECTRON_AGENT_GUIDE.md](ELECTRON_AGENT_GUIDE.md) | Original Electron mental model | Stub — merged into [`../ELECTRON.md`](../ELECTRON.md) |
| [ELECTRON_DESKTOP_HANDOFF.md](ELECTRON_DESKTOP_HANDOFF.md) | Operational snapshot of the desktop port | Stub — merged into [`../ELECTRON.md`](../ELECTRON.md) |
| [ELECTRON_DESKTOP_PLAN.md](ELECTRON_DESKTOP_PLAN.md) | Architecture rationale + step-by-step rollout | Full reference — Google Drive sections superseded by R2 |
| [ELECTRON_UXUI_RESEARCH.md](ELECTRON_UXUI_RESEARCH.md) | Long-form UX/UI research (Tailwind v4, Base UI, themes, vibrancy, first-paint) | Historical research — canonical CSS now in [`../CSS_CONVENTIONS.md`](../CSS_CONVENTIONS.md), process model in [`../ELECTRON.md`](../ELECTRON.md) |
| [HANDOFF_NEW_REPO.md](HANDOFF_NEW_REPO.md) | Extracting `weatherv1-next` from the monorepo | Stub — extraction shipped |
| [R2_MIGRATION_HISTORY.md](R2_MIGRATION_HISTORY.md) | R2 + Pulumi migration changelog (object key history, Basic Auth cutover, tagging passes) | Full historical reference — current state in [`../R2_PULUMI_HANDOFF.md`](../R2_PULUMI_HANDOFF.md) |
| [SECRETS_MANAGEMENT_AUDIT.md](SECRETS_MANAGEMENT_AUDIT.md) | Phased plan for every project secret + EDITOR/ADMIN hash pipeline + Windows-cert fix | Full reference — live rotation in [`../../infra/cloudflare/README.md`](../../infra/cloudflare/README.md#secrets-ownership--rotation) |
| [STATIC_HOSTING.md](STATIC_HOSTING.md) | Pages → Cloudflare Pages migration | Stub — shipped |
| [USAGE_ANALYTICS_UI_HANDOFF.md](USAGE_ANALYTICS_UI_HANDOFF.md) | Per-job usage/cost UI styling | Stub — shipped |
| [WINDOWS_INSTALLER_R2_TASK.md](WINDOWS_INSTALLER_R2_TASK.md) | Move Windows installer to R2 | Stub — shipped |
| [WINDOWS_INSTALLER_R2_PLAN.md](WINDOWS_INSTALLER_R2_PLAN.md) | Implementation plan for the task above | Stub — shipped |
