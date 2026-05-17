# Desktop Release Convention

Use this as the repeatable release runbook for WeatherV1 desktop installers.
It is written like a project skill: load the context, follow the workflow, verify
the outcome, and loop until the public download links work.

---

name: desktop-release-convention
description: Build and publish WeatherV1 desktop releases. Use when creating a
  new `v*` release tag, fixing release assets, validating GitHub Releases, or
  troubleshooting macOS/Windows installer delivery.

---

## When To Use

- The user asks for a new desktop release.
- The latest download links are broken or missing assets.
- A tagged release has only GitHub source archives.
- A packaged macOS/Windows build fails at startup.
- Release workflow, signing, notarization, or installer asset naming changes.

## Release Outputs

Every public desktop release uploads **only the Windows installer** to
Cloudflare R2 via the `weatherv1-r2-gateway` Worker:

- `WeatherV1-Setup.exe` — Windows only, CI-built.

No asset is attached to the GitHub Release. The tag exists; the auto-generated
Release page carries source archives only.

Public download URLs (served by the Worker's public `/downloads/*` route):

```text
https://<worker-host>/downloads/windows/latest/WeatherV1-Setup.exe
https://<worker-host>/downloads/windows/<tag>/WeatherV1-Setup.exe
```

`<worker-host>` is the deployed Worker host (today: `*.workers.dev`; later: a
custom domain). The `latest/` pointer is overwritten on every successful tagged
build with a 5-minute cache; the versioned key is immutable with a 1-year cache.

macOS is **not** built in CI. See "Building the macOS installer locally" below.

## Source Of Truth

- Desktop build workflow: `.github/workflows/desktop.yml`
- Release asset publisher: `.github/workflows/desktop-publish-release.yml`
- Download page workflow: `.github/workflows/pages.yml`
- Download page template: `docs/download-page/index.html.template`
- Packager config: `forge.config.cjs`
- Packaged Next spawn logic: `electron/server-manager.cjs`

## Required GitHub Secrets

A release tag run consumes these secrets via `.github/workflows/desktop.yml`
and `.github/workflows/desktop-publish-release.yml`. Every consumer and the
rotation procedure for each is documented in
[`../infra/cloudflare/README.md`](../infra/cloudflare/README.md#secrets-ownership--rotation).

| Secret | Used by | Required for |
| --- | --- | --- |
| `EDITOR_PASSWORD`, `ADMIN_PASSWORD` | `desktop.yml` → `scripts/emit-auth-hashes.cjs` | Argon2id hashing at prebuild — build fails loud if unset |
| `CLOUDFLARE_R2_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | `desktop-publish-release.yml` | Uploading `WeatherV1-Setup.exe` to R2 (R2-only token; pitch-deck.yml uses a separate `CLOUDFLARE_API_TOKEN` for Pages) |
| `GITHUB_TOKEN` | Auto-injected | Cross-run artifact download in the publish workflow |

A tag build with either `EDITOR_PASSWORD` or `ADMIN_PASSWORD` unset
fails loud at the guard step in `desktop.yml`. Windows installers ship
unsigned by design — users see a one-time SmartScreen "unknown
publisher" warning on first install. Non-tag builds skip the guard.

## Preflight Checklist

1. Confirm the working tree:

   ```bash
   git status --short
   git log -5 --oneline --decorate
   ```

2. Do not mix unrelated user changes into a release commit. If unrelated files
   are dirty, either leave them alone or ask before including them.

3. If code changed, run focused tests for the touched area. For packaged server
   startup changes, run:

   ```bash
   npm test -- src/test/server-manager.test.ts
   ```

4. Ensure `package.json` and `package-lock.json` will be bumped together.

## Version And Tag Workflow

Use the next patch version unless the user specifies otherwise.

```bash
npm version 0.1.x --no-git-tag-version
git add package.json package-lock.json <changed-files>
git commit -m "chore: bump version to 0.1.x"
git tag v0.1.x
git push origin main v0.1.x
```

If the release includes a bug fix, use a message that describes the fix rather
than only the version bump.

## GitHub Actions Loop

After pushing the tag:

1. Watch `Desktop` for the new tag.
2. Confirm the tag run uploads:
   - `desktop-windows-latest`
   - `release-ref`
3. Watch `Desktop publish to R2`.
4. Confirm the publish job succeeds.
5. Verify the Worker URLs serve the new installer:

   ```bash
   curl -I "https://<worker-host>/downloads/windows/latest/WeatherV1-Setup.exe"
   curl -I "https://<worker-host>/downloads/windows/v0.1.x/WeatherV1-Setup.exe"
   ```

   Both must return `200`, `content-type: application/octet-stream`, and
   `content-disposition: attachment; filename="WeatherV1-Setup.exe"`.

## Building the macOS installer locally

CI does not build macOS. To produce a notarized `WeatherV1-<ver>.zip` on a Mac:

1. Install Xcode Command Line Tools.
2. Export the signing/notarization env vars:
   `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`,
   `OSX_SIGN_IDENTITY`. Without these, `electron-forge make` still produces an
   *unsigned* zip but Gatekeeper will block it.
3. `npm run electron:make`.
4. Artifact: `out/make/zip/darwin/x64/WeatherV1-<ver>.zip`.

This zip is for ad-hoc distribution. There is no automation that uploads it to
R2 — the maintainer ships it directly to whoever asks.

## Failure Playbook

### Worker `/downloads/...` Returns 404

Cause: the Windows installer was never written to R2 for this tag.

Fix:

1. Confirm the `Desktop` tag run succeeded and has `desktop-windows-latest`.
2. Re-run `Desktop publish to R2`, or use its manual `workflow_dispatch`
   inputs with:
   - `tag`: `v0.1.x`
   - `run_id`: the successful `Desktop` run ID

### Worker `/downloads/...` Returns 401

Cause: the Worker isn't deployed yet, or the `/downloads/*` route was deployed
behind Basic Auth by mistake. Run `pulumi -C infra/cloudflare up` and verify
`infra/cloudflare/worker/r2-gateway.js` contains the public `/downloads/*`
branch *before* `checkBasicAuth(...)`.

### macOS Says The App Is Not Supported

Likely cause: wrong CPU architecture.

Current convention:

- Build public macOS ZIP with `electron-forge ... --arch=x64`.
- Intel Macs can run it directly.
- Apple Silicon Macs can run it through Rosetta.

### macOS Malware / Privacy Warning

Unsigned and unnotarized GitHub downloads will show Gatekeeper warnings.
Without the Apple Developer Program, users must use one of these bypasses:

```bash
xattr -dr com.apple.quarantine "/Applications/WeatherV1.app"
open "/Applications/WeatherV1.app"
```

Or Finder: right-click the app, choose **Open**, then confirm.

### Packaged App Fails With `spawn ENOTDIR`

Likely cause: trying to spawn from inside `app.asar` as a directory.

Fix location:

- `electron/server-manager.cjs`

Required behavior:

- Resolve packaged standalone server paths from `app.asar.unpacked`.
- Use Electron's bundled runtime with `ELECTRON_RUN_AS_NODE=1` unless
  `NODE_RUNTIME` is explicitly set.

## Success Criteria

A release is complete only when all are true:

- The tag exists locally and on origin.
- `Desktop` tag workflow succeeded.
- `Desktop publish to R2` succeeded.
- `https://<worker-host>/downloads/windows/latest/WeatherV1-Setup.exe`
  returns `200` with the expected headers.
- `https://<worker-host>/downloads/windows/<tag>/WeatherV1-Setup.exe` also
  returns `200` (immutable per-version pointer).
- Local git status is checked and unrelated dirty files are reported.

