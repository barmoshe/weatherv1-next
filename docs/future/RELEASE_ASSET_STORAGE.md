# Release Asset Storage — Research Findings & Recommendation

**Status:** research complete, recommendation below. Research conducted on branch `claude/add-code-documentation-zjfBw` after hitting 100% of the free 0.5 GB GitHub Actions storage quota on the `barmoshe` account (May 2026).

**Hard constraint from the user:** the chosen option must be **free**. No paid tiers, no overage billing. Only the latest release needs to be reachable.

**Related docs:** [`../RELEASE_CONVENTION.md`](../RELEASE_CONVENTION.md) · [`../CLOUDFLARE_INTEGRATION.md`](../CLOUDFLARE_INTEGRATION.md) · [`../R2_PULUMI_HANDOFF.md`](../R2_PULUMI_HANDOFF.md) · `.github/workflows/desktop.yml` · `.github/workflows/desktop-publish-release.yml`.

---

## TL;DR (the surprising finding)

**The storage problem is already solved.** The 100% quota alert was about **GitHub Actions artifact storage** (a 0.5 GB account-wide metered quota), not about Release assets. The `retention-days: 7` change shipped alongside this doc resolves that. **Release assets themselves are not metered on any GitHub plan** — the existing 22 GB across 27 releases costs $0 and would cost $0 even at 10× the current volume.

So the answer to "where should installers live" for cost reasons is: **leave them on GitHub Releases. No infra change.** Optional follow-ups are for tidiness or future-proofing (e.g. flipping the repo to private), not for the free-tier constraint.

## Verified facts (researched 2026-05-16)

### Current state — what is actually stored where

| Surface | Storage type | Metered? | Today's footprint |
| --- | --- | --- | --- |
| Intermediate CI artifacts (`desktop-macos-latest`, `desktop-windows-latest`, `release-ref`) | **GitHub Actions artifact storage**, 0.5 GB account-wide free quota | **Yes — this is what overflowed** | Was at 100%; now bounded by `retention-days: 7` from this branch's earlier commit |
| Installers on GitHub Releases (`WeatherV1-macOS.zip`, `WeatherV1-Setup.exe`) | **GitHub Release assets** | **No — uncounted on every plan** | **27 releases × ~870 MB = ~22 GB live** |

### Real installer sizes (from `mcp__github__list_releases` against `barmoshe/weatherv1-next`)

| Tag (selected) | `WeatherV1-macOS.zip` | `WeatherV1-Setup.exe` | Release total |
| --- | ---: | ---: | ---: |
| **v0.3.2 (latest)** | 433.9 MB | 434.4 MB | **868.3 MB** |
| v0.2.0 | 408.6 MB | 408.3 MB | 816.9 MB |
| v0.1.6 | 403.8 MB | 403.5 MB | 807.3 MB |

All 27 non-empty releases are in the **403-434 MB per-installer** range. Across all 27 releases: **~22 GB of release assets**.

> **Note for a separate session:** 434 MB per installer is unusually large for an Electron desktop app (typical: 100-200 MB). Likely culprits — `ffmpeg-static` + `ffprobe-static` (~70 MB each, unpacked from ASAR per `forge.config.cjs`), the entire `.next/standalone` tree also unpacked, and `node_modules` traced into the bundle. **This is out of scope here** but worth a "reduce installer size" task — would cut both CI runtime, download time, and any future mirror costs proportionally.

### Free-tier limits (verified May 2026)

| Surface | Per-file limit | Total/quota | Bandwidth | Verdict |
| --- | --- | --- | --- | --- |
| **GitHub Release assets** | **2 GB** | **Unlimited** (not metered) | **Unlimited** (not metered) | ✅ Installer fits (434 MB << 2 GB). Already in use. Zero cost forever. |
| **Cloudflare R2 free tier** | 4.995 TiB (single-part upload limit; ours is irrelevant) | **10 GB storage** | **Free egress, always** (Class A 1 M/mo free, Class B 10 M/mo free) | ✅ for "latest only" (~870 MB << 10 GB). ❌ if mirroring history (22 GB > 10 GB). |
| **Cloudflare Pages** | **25 MiB per file** (hard, all plans) | 20 000 files/deploy | Unlimited | ❌ Installer is 434 MB — **17× over** the limit. Disqualified. |
| **Git LFS (free)** | 2 GB | **1 GB storage + 1 GB bandwidth/month** | 1 GB/mo | ❌ Smaller than the Actions quota that overflowed. Disqualified. |
| **AWS S3 / Backblaze B2** | n/a | small free tier | **Egress billed** | ❌ Surprise-bill risk. Disqualified under "free" constraint. |

### Cloudflare R2 `r2.dev` is dev-only

Researching the public-bucket access path revealed an important caveat: R2 public buckets exposed via the Cloudflare-managed `pub-<hash>.r2.dev` subdomain are **explicitly rate-limited and intended for non-production traffic**. For production-grade access (no rate limit, WAF rules, caching control), Cloudflare requires attaching a **custom domain** to the bucket — which is still free but requires DNS work and is incompatible with running the repo without a registered domain.

**Implication:** if a future session implements the R2 mirror (option 2 below), plan on a custom domain from day one. Don't ship a pitch-deck link pointing at `*.r2.dev` — it will get rate-limited.

### `gh release delete --cleanup-tag` behavior

Confirmed:
- Flag exists since GitHub CLI **2.35.0** (well past current stable).
- Deletes the GitHub Release **and the remote git tag**.
- Known limitation ([cli/cli#7853](https://github.com/cli/cli/issues/7853)): does **not** clean up local tags on the operator's machine. Irrelevant for a server-side prune workflow.
- Without the flag, only the Release object is removed; the tag survives.

---

## Recommendation

### Primary: do nothing for storage cost reasons

The free-tier constraint is already satisfied by the status quo:
- ✅ CI artifact retention now capped at 7 days (shipped on this branch).
- ✅ Release assets are free and unmetered on GitHub.
- ✅ Current `releases/latest/download/<file>` URLs work; pitch deck unchanged.

**No further work required to keep release storage free.**

### Optional follow-up #1: prune old releases for tidiness

Not needed for cost, but valuable for:
- Keeping the GitHub Releases page short and focused on what users should install.
- Reducing scrape surface (every old installer is a public URL).
- Reducing search/SEO clutter.

Recommended **N = 3** (latest + two rollback targets), not `N = 1`. Single-release retention is brittle: if a hotfix regresses, there's no published prior version to point a user at while you fix forward.

Sketch (`.github/workflows/release-prune.yml`):

```yaml
name: Release prune
on:
  workflow_run:
    workflows: [Desktop publish release]
    types: [completed]
  workflow_dispatch:
permissions:
  contents: write
jobs:
  prune:
    if: github.event_name == 'workflow_dispatch' || github.event.workflow_run.conclusion == 'success'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          KEEP: 3
        run: |
          set -euo pipefail
          # Keep $KEEP newest non-prerelease, non-draft releases; delete the rest WITH their tags.
          gh release list --limit 100 --json tagName,isPrerelease,isDraft,createdAt \
            --jq 'map(select(.isPrerelease==false and .isDraft==false)) | sort_by(.createdAt) | reverse | .[env.KEEP|tonumber:] | .[].tagName' \
            | while read -r tag; do
                echo "Deleting release + tag: $tag"
                gh release delete "$tag" --yes --cleanup-tag
              done
```

**Caveats before merging:**
- The first run will delete ~24 of the 27 existing releases (≈19 GB of asset space, harmless since it's not metered, but irreversible). Run once manually with `KEEP=27` or higher to validate, then drop to `KEEP=3`.
- The `--cleanup-tag` flag means version tags are also gone — that's fine for the release page, but `git tag --list 'v*'` on developer machines will diverge from the remote. Add a note to `RELEASE_CONVENTION.md` about it.
- Confirm `N=3` with the user before shipping.

### Optional follow-up #2: R2 mirror — only if the repo goes private

`releases/latest/download/<file>` URLs **require authentication for private repos**. If the repo flips to private (see [`STATIC_HOSTING.md`](./STATIC_HOSTING.md)), the pitch-deck download buttons break.

At that point, mirroring `latest/*` to R2 becomes mandatory. Plan:

1. Add a `cloudflare.R2PublicBucket` (or attach a custom domain to an existing one) in `infra/cloudflare/index.ts`. **Use a custom domain from day one** — do not rely on `*.r2.dev` (rate-limited, dev-only per Cloudflare docs).
2. Add an upload step to `desktop-publish-release.yml` after the `gh-release` step:
   ```yaml
   - uses: cloudflare/wrangler-action@v3
     with:
       apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
       accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
       command: r2 object put weatherv1-releases/latest/WeatherV1-macOS.zip --file=dist/WeatherV1-macOS.zip
   ```
   …and one for the Windows installer. Always to the same `latest/` keys; no per-version path.
3. Repoint pitch-deck buttons at the custom domain.
4. **Do not extend the existing `r2-gateway.js` Worker** to serve these — that Worker is the auth-gated perimeter for desktop media (see warning in `STATIC_HOSTING.md`). Use a separate public bucket + domain.

Storage cost: ~870 MB used of 10 GB free. Egress: free (R2's core selling point). Ops: nowhere near the 1 M / 10 M monthly free caps for a desktop app's release downloads.

### Discarded options (with reasons)

- **Cloudflare Pages** — 25 MiB per-file limit; installer is 434 MB. Even compressed splits would be a hack.
- **Git LFS** — 1 GB/mo bandwidth on free; would last about two `WeatherV1-Setup.exe` downloads.
- **AWS S3 / Backblaze B2** — egress is billed; surprise-bill risk violates the "free" constraint.
- **Mirror to R2 today (without going private)** — adds infra, secrets, and a second source of truth for zero benefit while GitHub Releases works. Defer.

---

## Done means (if the follow-ups are executed)

For follow-up #1 (prune workflow):

- [ ] `.github/workflows/release-prune.yml` exists and is triggered by `workflow_run` after `desktop-publish-release.yml`.
- [ ] First run validated with a dry value of `KEEP` before lowering to the agreed `N`.
- [ ] `docs/RELEASE_CONVENTION.md` notes that old tags are deleted by automation.
- [ ] This file moves to [`../archive/`](../archive/) and `docs/DOCS_INDEX.md` is updated.

For follow-up #2 (R2 mirror, only if going private):

- [ ] `infra/cloudflare/index.ts` defines a public R2 bucket + custom domain (Pulumi-managed).
- [ ] CI secrets `CLOUDFLARE_API_TOKEN` (Pages-scoped is fine if same account) and `CLOUDFLARE_ACCOUNT_ID` set.
- [ ] `desktop-publish-release.yml` uploads to `latest/*` keys on the public bucket.
- [ ] Pitch-deck template (`docs/download-page/index.html.template`) repointed to the custom domain.
- [ ] Verified `curl -I https://<custom-domain>/WeatherV1-macOS.zip` returns 200.

## Open questions for the executing session

1. **`KEEP` value for the prune workflow** — recommend `3`, but confirm with user. `1` is risky (no rollback target); `5+` is harmless but visually noisier on the Releases page.
2. **Investigate installer size before doing anything fancier** — at 434 MB, every option (including R2's free tier) gets uncomfortably tight after another 10× of versioned mirroring. A separate "trim installer" task is probably higher-leverage than any storage migration.
3. **Privacy flip timing** (see [`STATIC_HOSTING.md`](./STATIC_HOSTING.md)) — if a privacy flip is on the horizon, do follow-up #2 **before** the flip, not after, so the pitch-deck never breaks.

## Non-goals

- Solving the Actions storage quota itself — already handled by `retention-days: 7` in `desktop.yml`.
- Mirroring intermediate CI artifacts anywhere. Only published installers matter.
- Building an autoupdater backend — see [`MANUAL_UPDATE_CHECK.md`](./MANUAL_UPDATE_CHECK.md). All options here are compatible.
- Shrinking the installer — separate task, mentioned for visibility only.

## References

- GitHub Releases (per-file 2 GB, total unmetered): [filesize.org/limits/github](https://filesize.org/limits/github/) · [gitprotect.io/blog/github-storage-limits](https://gitprotect.io/blog/github-storage-limits/)
- GitHub Actions storage billing: [docs.github.com/billing/managing-billing-for-github-actions](https://docs.github.com/billing/managing-billing-for-github-actions/about-billing-for-github-actions)
- Cloudflare R2 free tier & pricing: [developers.cloudflare.com/r2/pricing](https://developers.cloudflare.com/r2/pricing/) · [freetier.co/directory/products/cloudflare-r2](https://freetier.co/directory/products/cloudflare-r2)
- R2 public buckets (r2.dev rate limits, custom-domain requirement for prod): [developers.cloudflare.com/r2/buckets/public-buckets](https://developers.cloudflare.com/r2/buckets/public-buckets/)
- Cloudflare Pages 25 MiB per-file limit: [developers.cloudflare.com/pages/platform/limits](https://developers.cloudflare.com/pages/platform/limits/) · [community.cloudflare.com 25mb thread](https://community.cloudflare.com/t/cloudflare-pages-25mb-file-size-limit/388324)
- `gh release` CLI reference: [cli.github.com/manual/gh_release_delete](https://cli.github.com/manual/gh_release_delete) · [cli/cli#7853 (local-tag bug)](https://github.com/cli/cli/issues/7853)
