# RELEASE_ASSET_STORAGE — Concluded

Research task: where to host desktop installers (latest-only) without paying Actions overage. **Verdict: no infra change needed** — installers are served from R2 via the Worker's public `/downloads/*` route (see [`../RELEASE_CONVENTION.md`](../RELEASE_CONVENTION.md)). Kept as historical reference for the cost analysis.
