---
name: weatherv1-release
description: Drive a WeatherV1 desktop release end-to-end — preflight, version bump, tag and push, watch the two GitHub workflows, and verify both installer assets resolve from the latest-download URLs. Use when the user asks for a new desktop release, when latest download links are broken or return 404, when a tagged release page is missing installer assets, or when a packaged build fails at startup after a tag.
---

# WeatherV1 Release Driver

This skill executes the procedure documented in
[`docs/RELEASE_CONVENTION.md`](../../../docs/RELEASE_CONVENTION.md). Always
read that doc first — it is the source of truth and may have been updated
since this skill was written. The skill is a thin orchestrator, not a
duplicate.

## Load Order

1. Read `docs/RELEASE_CONVENTION.md` (full).
2. Read `docs/PROJECT_GOAL.md` to confirm no release-blocking goals are open.
3. If a failure-playbook entry is relevant, read the named source file before
   touching anything:
   - `electron/server-manager.cjs` (packaged spawn issues)
   - `forge.config.cjs` (asar.unpack, signing, makers)
   - `.github/workflows/desktop.yml` (build + artifacts)
   - `.github/workflows/desktop-publish-release.yml` (asset attachment)

## Preflight

Run sequentially in the child repo root. Stop on first failure and report to
the user — do not auto-fix.

```bash
git status --short
git log -5 --oneline --decorate
npx tsc --noEmit
npm test
```

If `git status` shows unrelated dirty files, list them and ask the user
before continuing. Do not mix unrelated changes into a release commit.

## Version And Tag Workflow

Use the next patch version unless the user specifies major or minor. Surface
the commands; require explicit user "ready to push?" confirmation before the
push.

```bash
npm version 0.1.x --no-git-tag-version
git add package.json package-lock.json
git commit -m "chore(release): v0.1.x"
git tag v0.1.x
git push origin main v0.1.x
```

`main` and the new tag must be pushed in the same `git push` invocation so
the publish workflow sees both at the same `workflow_run` reference.

## CI Watch Loop

After push, watch in order:

1. `Desktop` workflow for the tag. Required artifacts uploaded by the run:
   - `desktop-windows-latest`
   - `release-ref` (tiny artifact carrying the tag name)
2. `Desktop publish to R2` (triggers on `workflow_run` after `Desktop`
   completes). Required: job succeeds and uploads to both the versioned and
   the `latest/` R2 keys.
3. Verify the Worker URL serves the new installer:

```bash
curl -I "https://<worker-host>/downloads/windows/latest/WeatherV1-Setup.exe"
# expect: 200,
#         content-type: application/octet-stream,
#         content-disposition: attachment; filename="WeatherV1-Setup.exe"
curl -I "https://<worker-host>/downloads/windows/v0.1.x/WeatherV1-Setup.exe"
# same headers; immutable per-version pointer
```

No macOS asset is expected — CI does not build macOS. For ad-hoc Mac builds
see "Building the macOS installer locally" in `docs/RELEASE_CONVENTION.md`.

## Failure Routing

| Symptom | Read | Fix entry point |
| --- | --- | --- |
| Worker `/downloads/...` returns 404 | RELEASE_CONVENTION "Worker `/downloads/...` Returns 404" | re-run `Desktop publish to R2` with `workflow_dispatch` inputs `tag` + `run_id` |
| Worker `/downloads/...` returns 401 | RELEASE_CONVENTION "Worker `/downloads/...` Returns 401" | redeploy Worker via `pulumi -C infra/cloudflare up`; confirm public branch lives before `checkBasicAuth(...)` |
| macOS "not supported on this Mac" | RELEASE_CONVENTION "Not Supported" | confirm `--arch=x64`; Apple Silicon runs via Rosetta |
| macOS Gatekeeper / quarantine warning | RELEASE_CONVENTION "Malware / Privacy Warning" | `xattr -dr com.apple.quarantine` bypass; long-term needs Apple signing secrets |
| Packaged app dies with `spawn ENOTDIR` | RELEASE_CONVENTION "spawn ENOTDIR" | `electron/server-manager.cjs` — confirm `app.asar.unpacked` rewrite + `ELECTRON_RUN_AS_NODE=1` |

## Success Criteria

Report to the user, item by item:

- Tag exists locally and on origin.
- `Desktop` workflow green for the tag.
- `Desktop publish to R2` green for the tag.
- `https://<worker-host>/downloads/windows/latest/WeatherV1-Setup.exe`
  returns `200` with `content-type: application/octet-stream` and
  `content-disposition: attachment; filename="WeatherV1-Setup.exe"`.
- `https://<worker-host>/downloads/windows/<tag>/WeatherV1-Setup.exe` also
  returns `200`.
- Any unrelated dirty files at preflight reported to the user.

## What This Skill Does Not Do

- Code-sign or notarize locally. Signing requires the CI secrets listed in
  `forge.config.cjs:21-27`; local Forge runs skip signing.
- Edit the download page template. That lives at
  `docs/download-page/index.html.template` and is published by
  `.github/workflows/pitch-deck.yml` independently.
- Auto-rollback a bad release. If a release ships broken assets, delete the
  bad release through the GitHub UI before re-running publish.
