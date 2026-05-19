# [COMPLETED] Handoff — rotate leaked `EDITOR_PASSWORD` + scrub in-tree references

**Date:** 2026-05-17 (completed 2026-05-19)
**Owner:** next local agent (rotation must happen from a trusted machine)
**Severity:** medium — secret exposure, no signs of misuse yet

> **Resolution (2026-05-19):** `EDITOR_PASSWORD` rotated in GH secret + Worker
> binding; in-tree reference scrubbed via [PR #9](https://github.com/barmoshe/weatherv1-next/pull/9);
> `rotate-worker-secrets.yml` verify step hardened in the same PR; desktop
> `v0.3.15` released with the new Argon2id hash (Desktop + publish-to-R2 both green;
> `/downloads/windows/{latest,v0.3.15}/WeatherV1-Setup.exe` → 200). Leaked branch
> `claude/premiere-render-integration-research-YWttn` left in place — its commits
> are ancestors of `main` so deletion would be a no-op; history purge skipped
> per handoff guidance (rotation makes the value worthless). User to mark
> GitGuardian alert as revoked.
**Trigger:** GitGuardian alert "Curl Username Password" on
`barmoshe/weatherv1-next`, commit `632b9af`, detected 2026-05-17 09:48 UTC.
**Runbook to follow:** [`docs/RUNBOOK_WORKER_ROTATION.md`](../docs/RUNBOOK_WORKER_ROTATION.md)

> This handoff intentionally does **not** include the leaked password
> value — pull it from the locations listed under "Where it leaked" if
> you need to confirm.

## What leaked

The R2 gateway Worker Basic-Auth username + password
(`R2_APP_USERNAME` + `EDITOR_PASSWORD`). Same password also gates the
in-app editor login. Both values are baked into shipped desktop
installers as Argon2id hashes, so existing installs keep working until
they're re-issued.

## Where it leaked

| Location | Type | On HEAD? |
|---|---|---|
| `.github/workflows/_temp-rotate-worker-secrets.yml` (line with `-u "<user>:<pass>"`) | Plaintext in a `curl` invocation. Added in commit `632b9af` on branch `claude/premiere-render-integration-research-YWttn`. | **No** on `main`. Yes on that one branch. |
| `.claude/archive/HANDOFF-2026-05-17-r2-worker-proxy-and-unified-auth.md:81` | Plaintext in prose (`` `EDITOR_PASSWORD` (`<pass>`) ``). | **Yes on `main`** — present in every recent commit. |

Predecessor commit `845f257` on the same branch
(`_temp-rotate-worker-creds.yml`) does **not** contain the credential
itself but is part of the same incident — see "Branch cleanup".

## Next steps — Immediately

These are ordered. Do not skip rotation or you'll redact the references
to a password that's still live.

1. **Rotate `EDITOR_PASSWORD`** (canonical secret, GitHub):
   ```bash
   gh secret set EDITOR_PASSWORD --body 'NEW-PASSWORD'   # choose ≥20 chars
   ```
2. **Push the new value to the Worker** via the existing rotation
   workflow:
   ```bash
   gh workflow run rotate-worker-secrets.yml
   gh run watch
   ```
   The workflow runs `wrangler secret bulk` and then probes
   `/v1/catalog` with the new credential to confirm.
3. **Resolve the GitGuardian incident** as "revoked" once step 2 is
   green (link in the alert email).
4. **Redact in-tree references** on the working branch
   `claude/fix-issue-jU1ag` (or whatever's current). One commit:
   - Edit `.claude/archive/HANDOFF-2026-05-17-r2-worker-proxy-and-unified-auth.md:81`
     — replace `` `EDITOR_PASSWORD` (`<pass>`) `` with
     `` `EDITOR_PASSWORD` (value redacted 2026-05-17 after leak; see
     `.claude/HANDOFF-2026-05-17-rotate-leaked-editor-password.md`) ``.
   - Commit: `docs(security): redact leaked EDITOR_PASSWORD from archived handoff`.
   - Push and open / update the PR.
5. **Cut a desktop release** so packaged installers carry the new
   Argon2id hash (`/weatherv1-release` or the manual flow in
   [`docs/RELEASE_CONVENTION.md`](../docs/RELEASE_CONVENTION.md)).
   Installed clients keep working with the old password until users
   re-enter the new one — flag this to anyone running a packaged build.

## Next steps — Then (deferred / nice-to-have)

- **Branch cleanup.** Delete or rewrite
  `claude/premiere-render-integration-research-YWttn`:
  ```bash
  # If the branch's other commits aren't worth keeping:
  git push origin --delete claude/premiere-render-integration-research-YWttn
  # Otherwise rebase to drop 845f257 and 632b9af, then force-push.
  ```
  Confirm with the user before either — the branch has unrelated
  research commits on top.
- **History purge (only if compliance demands it).** The credential is
  in git history on the branch above and in the `.claude/archive/`
  handoff across many commits on `main`. Rotation makes the value
  worthless, so a `git filter-repo` / BFG rewrite is usually skipped.
  Only do this if a stakeholder asks and you've coordinated a
  force-push window — it invalidates every open PR and every cloned
  checkout.
- **Lint guard.** Consider adding a CI check that fails when
  `secrets.EDITOR_PASSWORD` (or any GH secret) shows up anywhere
  except a `${{ secrets.* }}` reference in a workflow file. gitleaks
  with a custom rule is the lightest option.

## Verification checklist

Tick these once rotation is done.

- [ ] `gh secret list` shows `EDITOR_PASSWORD` updated (date column).
- [ ] `rotate-worker-secrets.yml` last run is green.
- [ ] Manual curl against the Worker with the **new** password returns
      `200`:
      ```bash
      curl -sS -o /dev/null -w '%{http_code}\n' \
        -u "v1editor:NEW-PASSWORD" \
        https://weatherv1-r2-gateway.barprojectsandbuilds.workers.dev/v1/catalog?tenantId=default
      ```
- [ ] Manual curl with the **old** password returns `401`.
- [ ] `git grep -n '<old-pass>'` on `main` returns no matches after the
      redaction commit lands.
- [ ] GitGuardian incident marked resolved.
- [ ] New desktop release tagged + workflow artifacts uploaded.

## Notes for the next agent

- The username (`v1editor`) is not sensitive on its own — it's the
  default in [`docs/RUNBOOK_WORKER_ROTATION.md`](../docs/RUNBOOK_WORKER_ROTATION.md)
  and shows up in `R2_APP_USERNAME` (GH secret only by convention).
  Don't bother rotating it.
- Do **not** redact the in-tree reference **before** rotating. The
  audit trail is the only way the user can confirm what password was
  exposed; once rotated, the value is harmless and can be scrubbed.
- The CLAUDE.md safety rule "Do not store API keys in renderer
  `localStorage`" is unrelated but worth re-reading — the
  `EDITOR_PASSWORD` flow already uses `safeStorage`, this incident is
  CI/docs hygiene, not a runtime regression.

## Move to `archive/` when done

Once every box above is ticked, rename to
`.claude/archive/HANDOFF-2026-05-17-rotate-leaked-editor-password.md`
and prefix the title with `[COMPLETED]`.
