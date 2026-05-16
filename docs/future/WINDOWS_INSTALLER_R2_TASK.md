# Task: Host Windows installer in R2, drop macOS from CI

**Status:** planned. Implementation plan in
[`WINDOWS_INSTALLER_R2_PLAN.md`](./WINDOWS_INSTALLER_R2_PLAN.md).

**Related:** [`RELEASE_ASSET_STORAGE.md`](./RELEASE_ASSET_STORAGE.md)
(earlier research; this task partially supersedes its "follow-up #2") ·
[`../RELEASE_CONVENTION.md`](../RELEASE_CONVENTION.md) ·
[`../CLOUDFLARE_INTEGRATION.md`](../CLOUDFLARE_INTEGRATION.md) ·
`.github/workflows/desktop.yml` · `.github/workflows/desktop-publish-release.yml`.

## Goal

Move the public Windows installer download from GitHub Releases to
Cloudflare R2, served by the existing `weatherv1-r2-gateway` Worker via a
new public `GET /downloads/*` route. Stop attaching `WeatherV1-Setup.exe`
to GitHub Releases. Surface a clear "contact me for a Mac build" note in
the download page where the macOS button used to be. Keep the option to
build the macOS installer **locally** intact and documented.

## Why now

- macOS was already dropped from the CI build matrix in commit `dfb5871`,
  so the `releases/latest/download/WeatherV1-macOS.zip` URL on the
  download page is currently broken.
- GitHub Releases is no longer the right surface for the public Windows
  download: we want one Cloudflare-controlled URL we can move behind a
  custom domain later without touching the GitHub Releases UX or the tag
  flow.
- Centralizing on R2 keeps every public download artifact under one
  Cloudflare account, making future analytics / cache rules / WAF rules
  easier to add.

## Decisions (already settled with the user)

1. **One bucket, one Worker.** Extend the existing
   `weatherv1-r2-gateway` Worker with a public `/downloads/*` route
   instead of provisioning a separate public bucket with a custom domain.
   - **This intentionally diverges** from the recommendation in
     [`RELEASE_ASSET_STORAGE.md`](./RELEASE_ASSET_STORAGE.md) §"Optional
     follow-up #2" ("Do not extend the existing `r2-gateway.js` Worker").
   - Tradeoff accepted: one Worker now does both auth-gated app traffic
     and public download traffic. Isolation is enforced by **two
     independent guardrails**:
     - The new public route only reads R2 keys under the `downloads/`
       prefix (after a strict whitelist regex on the path).
     - Existing desktop temp credentials scope to `tenants/<id>/` only
       (`worker/r2-gateway.js:93`), so an attacker who steals a temp
       cred still cannot touch `downloads/`.
   - Revisit if/when we want a custom domain or per-route Worker metrics
     — at that point splitting into a dedicated public Worker is cheap.

2. **R2 only — no GitHub Release asset.** The
   `softprops/action-gh-release` step in
   `.github/workflows/desktop-publish-release.yml` is deleted. The tag
   still exists; the GitHub Release object may still auto-generate from
   the tag, but it carries no installer asset.

3. **Two stable pointers in R2.**
   - `downloads/windows/latest/WeatherV1-Setup.exe` — updated on every
     successful tagged build.
   - `downloads/windows/latest-stable/WeatherV1-Setup.exe` —
     **placeholder for now.** Once we adopt a stable-vs-prerelease tag
     convention (likely SemVer prerelease suffix detection), gate a
     second `wrangler r2 object put` on the stable check. Left as a
     marked `TODO` in the workflow so it's discoverable.
   - Versioned key (`downloads/windows/<tag>/WeatherV1-Setup.exe`) is
     also written so old releases stay addressable.

4. **Download page macOS section.** Replace the macOS button with a
   short Hebrew **plain-text line, no link**, indicating the visitor
   should contact the maintainer directly for a Mac build.

5. **Local Mac build path stays first-class.** `forge.config.cjs` is
   already set up for `@electron-forge/maker-zip` on darwin with optional
   notarization (`forge.config.cjs:89-121`). `npm run electron:make` on a
   macOS host with `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` /
   `APPLE_TEAM_ID` / `OSX_SIGN_IDENTITY` set produces
   `out/make/zip/darwin/x64/WeatherV1-<ver>.zip`. No code change —
   needs a short "Building macOS locally" doc section.

## Requirements

- A user landing on
  [weatherv1-download.pages.dev](https://weatherv1-download.pages.dev)
  clicks the Windows download button and downloads
  `WeatherV1-Setup.exe` from the Worker URL with
  `Content-Disposition: attachment` and correct content length.
- A tagged release (`v*`) on `main` automatically:
  1. Builds the Windows installer (existing `desktop.yml`).
  2. Writes the `.exe` to **two** R2 keys —
     `downloads/windows/<tag>/...` (immutable, long cache) and
     `downloads/windows/latest/...` (short cache).
  3. **Does not** attach the `.exe` to the GitHub Release.
- The existing private routes on `r2-gateway.js`
  (`/v1/health`, `/v1/r2/temporary-credentials`, `/v1/catalog`) still
  require Basic Auth and behave unchanged.
- Pulumi `pulumi up` redeploys the Worker (picks up the new
  `contentSha256`) without manual intervention.
- The pitch-deck workflow renders the download page with a real URL
  substituted for the `__WIN_INSTALLER_URL__` token — never the literal
  token.
- `npm run electron:make` on a Mac still produces a working notarized
  zip without code change.

## Done means

- [ ] `GET https://<worker-host>/downloads/windows/latest/WeatherV1-Setup.exe`
  returns `200`, `Content-Type: application/octet-stream`,
  `Content-Disposition: attachment; filename="WeatherV1-Setup.exe"`,
  and ranged requests return `206`.
- [ ] `GET https://<worker-host>/v1/catalog` still returns `401`
  without Basic Auth (existing perimeter intact).
- [ ] A throwaway tag (`v0.0.0-test1`) on a side branch produces
  objects at `downloads/windows/v0.0.0-test1/...` and
  `downloads/windows/latest/...`; the matching GitHub Release has
  **no** `.exe` asset attached.
- [ ] `https://weatherv1-download.pages.dev` Windows button points at
  the Worker URL (verified in rendered HTML and in the
  `downloadLinks` JS array).
- [ ] Hebrew macOS contact note renders in place of the old Mac
  button.
- [ ] `docs/RELEASE_CONVENTION.md` documents the local Mac build path
  and the new Worker URLs; `.claude/skills/weatherv1-release/SKILL.md`
  verification step curls the Worker URL.
- [ ] `infra/cloudflare/README.md` documents the new public route.

## Out of scope

- Wiring up `latest-stable` upload logic (deferred until we pick a
  stable-tag convention; left as `TODO` in the workflow).
- Moving to a custom domain (`dl.weatherv1.com` or similar). The
  `*.workers.dev` URL is fine for now; a repo variable
  `WIN_INSTALLER_URL` makes the URL swap a config-only change.
- Auto-uploading the locally-built macOS zip to R2. Local Mac builds are
  ad-hoc and shipped manually by the maintainer.
- Reducing installer size (separate task, called out in
  [`RELEASE_ASSET_STORAGE.md`](./RELEASE_ASSET_STORAGE.md)).
- Pruning historical GitHub Releases (separate task, also in
  `RELEASE_ASSET_STORAGE.md`).

## Open follow-ups (file new tasks)

1. **Adopt a stable-tag convention** so `latest-stable` can be populated
   automatically. Most natural: SemVer prerelease detection — tags
   matching `^v[0-9]+\.[0-9]+\.[0-9]+$` are stable, anything with a
   suffix (`-beta.1`, `-rc.1`) is not.
2. **Custom domain for downloads** (e.g. `dl.weatherv1.com`) once we
   have a registered domain wired to the Cloudflare zone.
