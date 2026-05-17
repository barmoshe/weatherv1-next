# Archive

Historical / completed docs kept for reference. **Not** authoritative for current work — they describe shipped work, superseded designs, or one-off jobs.

| Doc | What it covers | Why archived |
| --- | --- | --- |
| [ELECTRON_AGENT_GUIDE.md](ELECTRON_AGENT_GUIDE.md) | Original Claude-facing Electron mental model | Merged into [`../ELECTRON.md`](../ELECTRON.md) |
| [ELECTRON_DESKTOP_HANDOFF.md](ELECTRON_DESKTOP_HANDOFF.md) | Operational snapshot of the desktop port | Merged into [`../ELECTRON.md`](../ELECTRON.md) |
| [ELECTRON_DESKTOP_PLAN.md](ELECTRON_DESKTOP_PLAN.md) | Architecture rationale + step-by-step rollout | Merged into [`../ELECTRON.md`](../ELECTRON.md); Google Drive sections superseded by R2 |
| [HANDOFF_NEW_REPO.md](HANDOFF_NEW_REPO.md) | Extracting `weatherv1-next` from the monorepo | Extraction shipped; repo is standalone |
| [CLOUDFLARE_R2_ELECTRON_STORAGE_PLAN.md](CLOUDFLARE_R2_ELECTRON_STORAGE_PLAN.md) | Pre-implementation R2 storage design | Superseded by live [`../R2_PULUMI_HANDOFF.md`](../R2_PULUMI_HANDOFF.md) |
| [CATALOG_TAGGING_HANDOFF.md](CATALOG_TAGGING_HANDOFF.md) | Segment poster + Hebrew description bulk-tag pipeline | All 408/408 segments tagged. Re-read only if re-segmenting |
| [USAGE_ANALYTICS_UI_HANDOFF.md](USAGE_ANALYTICS_UI_HANDOFF.md) | Per-job usage/cost UI styling guide | Behavior shipped; styling polish lives in `src/client/components/jobs/AnalyticsPanel.tsx` |
| [SECRETS_MANAGEMENT_AUDIT.md](SECRETS_MANAGEMENT_AUDIT.md) | Phased plan for every project secret (CI / Pulumi / runtime), incl. EDITOR/ADMIN build-time hash pipeline + Windows-cert decode fix | Phases 0/1/2/4 shipped; Phase 3 (CI `pulumi up`) reverted. Live rotation playbook lives at [`../../infra/cloudflare/README.md`](../../infra/cloudflare/README.md#secrets-ownership--rotation) |
| [EDITOR_AND_ADMIN_GATES.md](EDITOR_AND_ADMIN_GATES.md) | Editor login at app entry + Settings modal redesign into Editor/Admin tabs + shared Argon2id password layer | All phases shipped (login route, gate, two-tab Settings, full test suite). |
| [STATIC_HOSTING.md](STATIC_HOSTING.md) | Move pitch-deck site from GitHub Pages to Cloudflare Pages via Pulumi + `wrangler-action` | Shipped — `.github/workflows/pitch-deck.yml` + `infra/cloudflare/index.ts` `PagesProject` |
| [WINDOWS_INSTALLER_R2_TASK.md](WINDOWS_INSTALLER_R2_TASK.md) | Move public Windows installer download to R2 via the existing Worker; drop GitHub Release asset; macOS local-build only | Shipped — `.github/workflows/desktop-publish-release.yml` writes to R2; Worker serves `/downloads/*` |
| [WINDOWS_INSTALLER_R2_PLAN.md](WINDOWS_INSTALLER_R2_PLAN.md) | Implementation plan for the task above | Shipped alongside the task |
