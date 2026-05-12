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

Every public desktop release must publish these stable asset names:

- `WeatherV1-macOS.zip`
- `WeatherV1-Setup.exe`

The public download links are:

```text
https://github.com/barmoshe/weatherv1-next/releases/latest/download/WeatherV1-macOS.zip
https://github.com/barmoshe/weatherv1-next/releases/latest/download/WeatherV1-Setup.exe
```

## Source Of Truth

- Desktop build workflow: `.github/workflows/desktop.yml`
- Release asset publisher: `.github/workflows/desktop-publish-release.yml`
- Download page workflow: `.github/workflows/pages.yml`
- Download page template: `docs/download-page/index.html.template`
- Packager config: `forge.config.cjs`
- Packaged Next spawn logic: `electron/server-manager.cjs`

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
   - `desktop-macos-latest`
   - `desktop-windows-latest`
   - `release-ref`
3. Watch `Desktop publish release`.
4. Confirm the publish job succeeds.
5. Open the release page for the tag and confirm the two installer assets are
   present.
6. Check both latest links with redirects:

   ```bash
   curl -I -L --max-redirs 2 "https://github.com/barmoshe/weatherv1-next/releases/latest/download/WeatherV1-macOS.zip"
   curl -I -L --max-redirs 2 "https://github.com/barmoshe/weatherv1-next/releases/latest/download/WeatherV1-Setup.exe"
   ```

The `Location` header must point at the new tag, for example:

```text
https://github.com/barmoshe/weatherv1-next/releases/download/v0.1.x/WeatherV1-macOS.zip
```

## Failure Playbook

### Release Has Only Source Archives

Cause: the release exists, but installer assets were never attached.

Fix:

1. Confirm the `Desktop` tag run succeeded and has artifacts.
2. Re-run `Desktop publish release`, or use its manual `workflow_dispatch`
   inputs with:
   - `tag`: `v0.1.x`
   - `run_id`: the successful `Desktop` run ID

### `/releases/latest/download/...` Returns 404

Check:

- The latest release is not a draft.
- The latest release is not a pre-release.
- Asset names exactly match `WeatherV1-macOS.zip` and `WeatherV1-Setup.exe`.
- `Desktop publish release` used `make_latest: true`.

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
- `Desktop publish release` succeeded.
- GitHub Release page shows both installer assets.
- Latest download URLs redirect to the new tag.
- Local git status is checked and unrelated dirty files are reported.

