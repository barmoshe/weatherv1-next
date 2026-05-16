# Static Hosting Migration — Handoff

**Status:** plan only, not implemented. Created on branch `claude/static-hosting-research-UDU5h` during a cloud session. Execute from a local agent session (needs Pulumi state access + Cloudflare/GitHub credentials).

**Related docs:** [`R2_PULUMI_HANDOFF.md`](./R2_PULUMI_HANDOFF.md) (sibling Cloudflare infra) · [`CLOUDFLARE_INTEGRATION.md`](./CLOUDFLARE_INTEGRATION.md) · [`infra/cloudflare/README.md`](../infra/cloudflare/README.md).

---

## Goal

Move the pitch-deck / presentation site off **GitHub Pages** (which requires Pro for private repos) onto **Cloudflare Pages**, provisioned by the existing Pulumi project, deployed via `wrangler-action` from GitHub Actions. The repo can then be flipped to private with no loss of public hosting.

The site source (`docs/download-page/index.html.template` + `docs/download-page/assets/`) does **not** move. Only the build/deploy target changes.

## Decisions (locked in this plan)

| Decision | Choice | Why |
| --- | --- | --- |
| Hosting platform | **Cloudflare Pages** | Free, unlimited bandwidth, free custom domain + HTTPS, supports private repos, you already have a Cloudflare account + Pulumi stack. |
| Deploy method | **Direct upload via `wrangler-action`** in GH Actions | No need to install the Cloudflare GitHub App; build logic stays in `pages.yml` (just `sed`/`cp`); easy to debug; identical environment to today. |
| Pulumi stack | **Same stack** (`weatherv1-cloudflare` / `dev`) | Single `pulumi up` for all Cloudflare infra; Pages and R2 live in the same account; outputs co-located. If isolation is preferred later, split into `weatherv1-cloudflare-pages`. |
| Project name | `weatherv1-pitch` (configurable) | Matches the site's purpose (recent commits call it the "pitch deck"). `docs/download-page/` is a legacy name. |
| Custom domain | **Optional, deferred** | Default `weatherv1-pitch.pages.dev` is "nice enough." Wire a real domain only if the user provides one. |
| Reuse the existing R2 gateway Worker for hosting | **No** | The gateway is the auth-gated R2 perimeter for desktop media (see `infra/cloudflare/worker/r2-gateway.js`). Mixing a public unauth'd presentation route in widens its blast radius for zero benefit. Pages is purpose-built. |

## Done means

- [ ] `pulumi up` from `infra/cloudflare/` creates a `cloudflare.PagesProject` named `weatherv1-pitch` (configurable) under account `f73ae3550198c571ad20f9fd06632200`.
- [ ] `infra/cloudflare/index.ts` exports `pagesProjectName` and `pagesUrl`.
- [ ] `.github/workflows/pages.yml` builds the site exactly as today (same `sed` + `cp` block) and deploys `_site/` via `cloudflare/wrangler-action@v3 → pages deploy`.
- [ ] Repo secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` exist in GitHub Actions.
- [ ] First push to `main` (or `workflow_dispatch`) produces a green run; site responds at `https://weatherv1-pitch.pages.dev`.
- [ ] GitHub Pages is disabled in repo Settings → Pages (source: None) to stop duplicate deploys.
- [ ] (Optional) custom domain attached via `cloudflare.PagesDomain` and DNS verified.
- [ ] `docs/DOCS_INDEX.md` links this handoff in the Cloudflare section.
- [ ] Existing `R2_PULUMI_HANDOFF.md` infra is untouched (R2 bucket + Worker still functional).

## Pre-flight (do once, in order)

1. **Confirm Pulumi access.** From `infra/cloudflare/`, run `pulumi stack ls` and verify the `dev` stack is selectable with the operator's credentials/passphrase. If not, get it from the user before going further.
2. **Confirm account ID.** Already in `Pulumi.dev.yaml`: `f73ae3550198c571ad20f9fd06632200`. Sanity-check against the Cloudflare dashboard.
3. **Mint a Pages API token.** In Cloudflare dashboard → My Profile → API Tokens → Create. Permissions:
   - `Account` → `Cloudflare Pages` → `Edit`
   - `Account` → `Account Settings` → `Read`
   - Account resource: scope to the WeatherV1 account only.
   - This is **separate** from the existing `cloudflare:apiToken` (which is Pulumi's provider token) and `cloudflareApiToken` (Worker runtime token for R2 temp creds). Do **not** reuse either — see "two superficially similar tokens" in `infra/cloudflare/README.md`. The Pages CI token is a third, narrower one.
4. **Add GitHub Actions secrets** at the repo level (Settings → Secrets and variables → Actions):
   - `CLOUDFLARE_API_TOKEN` = the token from step 3.
   - `CLOUDFLARE_ACCOUNT_ID` = `f73ae3550198c571ad20f9fd06632200`.

## Implementation

### Step 1 — Extend `infra/cloudflare/index.ts`

Append after the existing `WorkersRoute` block, before the `export` lines:

```ts
// ─── Cloudflare Pages: pitch deck ────────────────────────────────────
const pagesProjectName = config.get("pagesProjectName") ?? "weatherv1-pitch";
const pagesProductionBranch = config.get("pagesProductionBranch") ?? "main";
const pagesCustomDomain = config.get("pagesCustomDomain"); // optional

const pitchDeckPages = new cloudflare.PagesProject("pitch-deck", {
  accountId,
  name: pagesProjectName,
  productionBranch: pagesProductionBranch,
  // No `source` block: direct-upload via wrangler in CI.
  // No `buildConfig`: build runs in GH Actions, Pages just receives the artifact.
});

if (pagesCustomDomain) {
  new cloudflare.PagesDomain("pitch-deck-domain", {
    accountId,
    projectName: pitchDeckPages.name,
    domain: pagesCustomDomain,
  }, { dependsOn: [pitchDeckPages] });
}
```

And add to the exports at the bottom:

```ts
export const pagesProjectName = pitchDeckPages.name;
export const pagesDefaultUrl = pulumi.interpolate`https://${pitchDeckPages.name}.pages.dev`;
export const pagesCustomDomainUrl = pagesCustomDomain
  ? `https://${pagesCustomDomain}`
  : undefined;
```

**API notes** (verified against `@pulumi/cloudflare` v6.15.0):
- `cloudflare.PagesProject` requires `accountId`, `name`, `productionBranch` since v6.11.0.
- Omit `source` to keep it a direct-upload project (no GitHub binding, no Cloudflare GitHub App install needed).
- `cloudflare.PagesDomain` needs `accountId`, `projectName`, `domain`.

### Step 2 — Pulumi config

From `infra/cloudflare/`:

```bash
# Required only if you want non-defaults
pulumi config set pagesProjectName weatherv1-pitch
pulumi config set pagesProductionBranch main

# Skip unless attaching a real domain
# pulumi config set pagesCustomDomain pitch.weatherv1.example
```

Then:

```bash
npm run typecheck
npm run preview   # confirm: 1 new PagesProject, nothing else changes
npm run up
```

**Expected preview output:** exactly one `+ create cloudflare:index:PagesProject pitch-deck`. Anything else (modifications to the R2 bucket, Worker, etc.) is a bug — abort and investigate. If `pagesCustomDomain` was set, expect a second `+ create cloudflare:index:PagesDomain` too.

Capture the new outputs:

```bash
pulumi stack output pagesProjectName
pulumi stack output pagesDefaultUrl
```

### Step 3 — Rewrite `.github/workflows/pages.yml`

Replace the file wholesale. The build stays identical; only the deploy mechanism changes.

```yaml
name: Pitch Deck

on:
  push:
    branches: [main]
    paths:
      - "docs/download-page/**"
      - "public/weather-v1-icon-512.png"
      - ".github/workflows/pages.yml"
  workflow_dispatch:

permissions:
  contents: read
  deployments: write   # for the GitHub Deployments env that wrangler-action creates

concurrency:
  group: pitch-deck-pages
  cancel-in-progress: false

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment:
      name: cloudflare-pages
    steps:
      - uses: actions/checkout@v5

      - name: Render pitch deck
        run: |
          set -euo pipefail
          mkdir -p _site/public _site/download-page/assets
          sed "s|__REPO__|${{ github.repository }}|g" docs/download-page/index.html.template > _site/index.html
          cp public/weather-v1-icon-512.png _site/public/weather-v1-icon-512.png
          if compgen -G "docs/download-page/assets/*" > /dev/null; then
            cp -R docs/download-page/assets/. _site/download-page/assets/
          fi

      - name: Deploy to Cloudflare Pages
        uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          command: pages deploy _site --project-name=weatherv1-pitch --branch=main
          gitHubToken: ${{ secrets.GITHUB_TOKEN }}
```

Notable diffs vs. the current file:
- `permissions.pages` and `permissions.id-token` removed (no GH Pages anymore).
- `deployments: write` added so wrangler-action can create a GitHub Deployment.
- The two-job `build` → `deploy` (`actions/upload-pages-artifact` + `actions/deploy-pages`) collapses into a single `deploy` job — the artifact lives only in the runner FS.
- `.nojekyll` no longer needed (Pages doesn't run Jekyll).
- `--branch=main` makes this a **production** deploy; PR runs would default to preview if you ever add `pull_request` triggers.
- If `pulumi config set pagesProjectName` was changed from the default, update the `--project-name=` flag to match.

### Step 4 — Disable old GitHub Pages

After the first successful Cloudflare deploy:

1. Repo Settings → **Pages** → set **Source** to "None". This stops the old `github-pages` environment from accepting deploys.
2. Optional: delete the `github-pages` environment under Settings → Environments to clean up.

If skipped, nothing breaks immediately, but `pulumi up`-driven changes won't be reflected on the `github.io` URL — only the Cloudflare one — which can confuse anyone bookmarking the old URL.

### Step 5 — (Optional) custom domain

Only if a real domain is provided:

1. `pulumi config set pagesCustomDomain pitch.weatherv1.example` (replace with real value).
2. `pulumi up` — creates the `PagesDomain` binding.
3. If the domain is in the same Cloudflare account, the DNS record is auto-created. Otherwise, manually add `CNAME pitch → weatherv1-pitch.pages.dev` at the registrar.
4. Wait for SSL provisioning (usually < 5 min). Verify in Cloudflare dashboard → Pages → project → Custom domains.

## Verification

After Step 3:

- Trigger `workflow_dispatch` on the new workflow. Expect green run < 60 s.
- `curl -I https://weatherv1-pitch.pages.dev` → `HTTP/2 200` with Hebrew title in HTML body.
- View the deployment in Cloudflare dashboard → Pages → `weatherv1-pitch` → Deployments → confirm "Production".
- Spot-check: load the page in a browser, verify the Hebrew RTL pitch deck renders with assets and icon.
- Run `npx tsc --noEmit` from `infra/cloudflare/` — Pulumi project still typechecks.

## Rollback

If Cloudflare Pages misbehaves:

1. Re-enable GitHub Pages: Settings → Pages → Source: "GitHub Actions".
2. `git revert` the workflow rewrite commit (Step 3). The old two-job workflow is restored.
3. Leave the Pulumi `PagesProject` in place (harmless, costs nothing) or `pulumi destroy --target …` it if a clean teardown is required. The R2 / Worker resources are independent and will not be touched.

Note: the repo must stay **public** for the rollback path to keep working on the free plan.

## Open questions for the local session

Ask the user before executing if any of these are unclear:

1. **Project name** — confirm `weatherv1-pitch`, or use something else (e.g. `weatherv1-presentation`, `weatherv1`)? Affects the default `.pages.dev` URL.
2. **Custom domain** — do they have one in mind? If yes, capture the FQDN and whether the zone is already in this Cloudflare account.
3. **Repo privacy timing** — flip to private before or after the Cloudflare deploy is verified green? Recommended: after.
4. **PR previews** — should `pull_request` events also deploy preview environments? Off by default in this plan to keep CI minutes low; trivial to add later via `--branch=$GITHUB_HEAD_REF` and a `pull_request:` trigger.
5. **Workflow rename** — `pages.yml` is now misleading. Rename to `pitch-deck.yml`? (Cosmetic only.)

## Files this plan will touch

- `infra/cloudflare/index.ts` — add `PagesProject` + optional `PagesDomain` + exports.
- `infra/cloudflare/Pulumi.dev.yaml` — new keys: `pagesProjectName`, `pagesProductionBranch`, optionally `pagesCustomDomain`.
- `infra/cloudflare/README.md` — short "Cloudflare Pages" section under Resources.
- `.github/workflows/pages.yml` — rewrite (or rename to `pitch-deck.yml`).
- `docs/DOCS_INDEX.md` — link this handoff in the Cloudflare section.
- `docs/STATIC_HOSTING_HANDOFF.md` — (this file).

No application code (`src/`, `electron/`) is touched.

## Cost & limits sanity check

Free Cloudflare Pages tier (as of 2026): unlimited bandwidth, 500 builds/mo, 1 concurrent build, 100 custom domains per project, 20 000 files per deploy, 25 MiB per file. The pitch-deck site is a single HTML + a small asset folder — every limit is multiple orders of magnitude over what we'd consume.

API token from Step 3 has no spend-impact — it can only edit Pages projects in the WeatherV1 account.

## References

- Pulumi: [`cloudflare.PagesProject`](https://www.pulumi.com/registry/packages/cloudflare/api-docs/pagesproject/) · [`cloudflare.PagesDomain`](https://www.pulumi.com/registry/packages/cloudflare/api-docs/pagesdomain/)
- [`cloudflare/wrangler-action`](https://github.com/cloudflare/wrangler-action)
- [Cloudflare Pages limits](https://developers.cloudflare.com/pages/platform/limits/)
- [Cloudflare API token permissions for Pages](https://docs.doppler.com/docs/cloudflare-pages)
