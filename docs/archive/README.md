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
| [SECRETS_MANAGEMENT_AUDIT.md](SECRETS_MANAGEMENT_AUDIT.md) | Phased plan for every project secret (CI / Pulumi / runtime), incl. EDITOR/ADMIN build-time hash pipeline, Windows-cert decode fix, Pulumi passphrase for CI `pulumi up` | All phases shipped. Live rotation playbook now lives at [`../../infra/cloudflare/README.md`](../../infra/cloudflare/README.md#secrets-ownership--rotation) |
