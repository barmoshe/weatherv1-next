# Release Asset Storage — Research Task

**Status:** research only, not implemented. Created on branch `claude/add-code-documentation-zjfBw` after hitting 100% of the free 0.5 GB GitHub Actions storage quota on the `barmoshe` account (May 2026).

**Hard constraint from the user:** the chosen option must be **free**. No paid tiers, no overage billing.

**Related docs:** [`../RELEASE_CONVENTION.md`](../RELEASE_CONVENTION.md) · [`../CLOUDFLARE_INTEGRATION.md`](../CLOUDFLARE_INTEGRATION.md) · [`../R2_PULUMI_HANDOFF.md`](../R2_PULUMI_HANDOFF.md) · `.github/workflows/desktop.yml` · `.github/workflows/desktop-publish-release.yml`.

---

## Goal

Decide where to host the desktop installers (`WeatherV1-macOS.zip`, `WeatherV1-Setup.exe`) so that:

1. **Only the latest release** needs to be reachable — historical builds can be dropped.
2. **Stable download URLs** remain valid across releases (the pitch deck and any external links point at "always the latest").
3. **Zero recurring cost** — no Actions storage overage, no paid CDN.
4. The release workflow stays a single push of a `v*` tag (see `RELEASE_CONVENTION.md`).

## Background — what is currently storing what

| Surface | Storage type | Counts against quota? | Lifetime today |
| --- | --- | --- | --- |
| Intermediate CI artifacts (`desktop-macos-latest`, `desktop-windows-latest`, `release-ref`) uploaded by `desktop.yml` | **GitHub Actions artifact storage** (0.5 GB free on free plan, **account-wide**) | **Yes — this is what overflowed** | 7 days (just shortened from default 90) |
| Final installers attached to the GitHub Release (`WeatherV1-macOS.zip`, `WeatherV1-Setup.exe`) via `softprops/action-gh-release` in `desktop-publish-release.yml` | **GitHub Release assets** | **No** — release assets are not metered against Actions storage | Forever, until the release is deleted |
| Pitch-deck "Download" buttons | Point at `https://github.com/barmoshe/weatherv1-next/releases/latest/download/<file>` | n/a | Resolves to whichever non-draft, non-prerelease release is marked "latest" |

So the immediate quota crisis is **only** about CI artifacts, not the installers themselves. The retention-days fix shipped alongside this doc addresses that. **This research task is the longer-term question: where should the installer for "the latest release" actually live?**

## Free candidates to evaluate

### 1. Status quo: GitHub Releases + auto-prune old releases

- **Cost:** free. Release assets are uncounted on all GitHub plans.
- **Latest URL:** already works today via `releases/latest/download/<file>`. No change needed.
- **"Only latest" enforcement:** add a tiny workflow step (or scheduled workflow) that runs after `desktop-publish-release.yml` succeeds and deletes all releases except the newest non-prerelease one. Use `gh release list --limit 100 --json tagName,isPrerelease,isLatest,createdAt` + `gh release delete <tag> --yes --cleanup-tag` for the cull.
- **Pros:** zero new infra; reuses existing tooling; pitch-deck links unchanged.
- **Cons:** deleting old tags is destructive — losing the ability to point users back at a known-good build if a new one regresses. Mitigate by keeping the **2 latest** instead of just 1.
- **Open question:** does GitHub bill for total Release asset size on the free plan in 2026? Re-check; as of late 2024 it did not, but the Actions quota change shows policies move.

### 2. Cloudflare R2 with a stable `latest/` prefix

- **Cost:** free tier — 10 GB storage, 1 M Class A ops/mo, 10 M Class B ops/mo, **egress free**. Two installer files (≈100–200 MB combined) fit comfortably; download volume from a small user base is nowhere near the op caps.
- **Latest URL:** publish to fixed keys like `latest/WeatherV1-macOS.zip` and `latest/WeatherV1-Setup.exe`. Expose via either:
   - a public R2 bucket subdomain (`pub-<hash>.r2.dev`), or
   - a Worker route on a custom domain (re-use / extend `r2-gateway.js`).
- **"Only latest" enforcement:** the publish workflow overwrites the same key; no prune step needed.
- **Pros:** already in the stack (Pulumi-managed, see `R2_PULUMI_HANDOFF.md`); fastest CDN; clean stable URL independent of GitHub release lifecycle; preserves the GitHub Release tag history for free.
- **Cons:** adds an upload step to `desktop-publish-release.yml`; needs a CI secret for R2 credentials (already exists for catalog sync — could reuse or scope a new one); the existing `r2-gateway.js` is the **auth-gated desktop perimeter** for media — do **not** mix public unauth installer routes into it (see the same warning in `STATIC_HOSTING.md`). Either use the public `r2.dev` URL or add a separate Worker.
- **Open question:** does serving public installers from `r2.dev` violate Cloudflare's R2 free-tier policy if the project goes private? Read current ToS before deciding.

### 3. Cloudflare Pages

- **Cost:** free.
- **Blocker:** **25 MiB per-file limit** on free Pages deploys. The Windows installer is likely over this. **Probably disqualifies this option** — verify by checking the size of `out/squirrel.windows/x64/WeatherV1-Setup.exe` from a recent build.
- Not pursuing further unless the size check surprises.

### 4. GitHub Pages + Git LFS

- **Cost:** free for Pages bandwidth, but **Git LFS has a 1 GB storage + 1 GB/mo bandwidth free quota** — even smaller than the Actions quota that just overflowed. **Disqualified.**

### 5. Backblaze B2 / AWS S3 / etc.

- All have free tiers but **egress is not free** (or capped low). Will produce surprise bills if a pitch-deck download spike happens. **Disqualified under the "free" constraint.**

## Recommendation (provisional, to be confirmed during research)

Combine 1 + 2 for defense in depth:

- **Keep GitHub Releases as the authoritative store** (option 1). It is free, already wired up, and `releases/latest/download/` already gives a stable URL. Add a cleanup step that keeps the **2 newest** non-prerelease releases and deletes the rest. This bounds total asset size to ≈400 MB.
- **Optionally mirror to R2** (option 2) if either: (a) GitHub starts metering release asset storage in the future, or (b) a faster CDN is wanted for non-US users. The mirror is purely additive — the primary URL stays on GitHub.

## Done means (when this task is executed)

- [ ] Decision recorded: "primary store = X, mirror = Y or none."
- [ ] If option 1 chosen alone: cleanup workflow `release-prune.yml` exists, scheduled or `workflow_run`-triggered after `desktop-publish-release.yml`, keeps N newest non-prerelease releases.
- [ ] If option 2 added: `desktop-publish-release.yml` has an extra step that uploads `dist/WeatherV1-macOS.zip` and `dist/WeatherV1-Setup.exe` to R2 under `latest/`. Pitch-deck download buttons either stay on GitHub or switch to the R2 URL (decided per "stable URL" goal).
- [ ] `docs/RELEASE_CONVENTION.md` updated with the chosen flow.
- [ ] `docs/DOCS_INDEX.md` and `docs/future/README.md` updated (this file moves to `../archive/` once shipped).
- [ ] Zero recurring cost confirmed by reading current GitHub + Cloudflare free-tier policies on the day of execution.

## Open questions for the executing session

1. **How many old releases to keep?** User said "I only care about the latest" — confirm whether `N=1` (strictest) or `N=2/3` (one rollback target retained) before destroying tags.
2. **Delete tag or just the release?** `gh release delete --cleanup-tag` removes the git tag too; without it the tag survives. The desktop release flow relies on the tag for version identity — losing it makes hotfixes harder. Recommend keeping the tag, deleting only the release + its assets.
3. **R2 public-bucket security model** — if mirroring to R2, audit whether public installer hosting is acceptable for the threat model (anyone can scrape installer URLs; no harm if installers are non-secret).
4. **Pitch-deck URL impact** — `docs/download-page/index.html.template` currently points at GitHub. If the chosen mirror changes the URL, update the template and re-deploy the Pages site.
5. **Privacy flip interaction** — if the repo goes private (see `STATIC_HOSTING.md`), `releases/latest/download/` requires authenticated requests. That makes option 2 (public R2 mirror) effectively mandatory before flipping. Sequence matters.

## Non-goals

- Solving the Actions storage quota itself — already handled by `retention-days: 7` in `desktop.yml`.
- Mirroring intermediate CI artifacts anywhere. Only the published installers matter.
- Building an autoupdater backend. See [`MANUAL_UPDATE_CHECK.md`](./MANUAL_UPDATE_CHECK.md) for the planned update flow; it's compatible with any of the options above.

## References

- GitHub Actions storage billing: https://docs.github.com/en/billing/managing-billing-for-your-products/managing-billing-for-github-actions/about-billing-for-github-actions
- GitHub Release asset limits: https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases (no per-asset count limit; 2 GB per file)
- Cloudflare R2 pricing & free tier: https://developers.cloudflare.com/r2/pricing/
- Cloudflare Pages limits (size cap reference): https://developers.cloudflare.com/pages/platform/limits/
- `gh release` CLI reference: https://cli.github.com/manual/gh_release
