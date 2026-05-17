---
name: weatherv1-commit
description: Draft a WeatherV1 commit following this repo's conventions — Conventional Commits style (type(scope): subject), only the files relevant to the request, and never bundling unrelated dirty work. Use whenever the user says "commit" or "make a commit"; also for release commits that must bump package.json and package-lock.json together.
---

# WeatherV1 Commit

Thin orchestrator for the commit conventions in
[`CLAUDE.md`](../../../CLAUDE.md) ("Conventions" + "Safety rules") and
[`docs/RELEASE_CONVENTION.md`](../../../docs/RELEASE_CONVENTION.md). Surface
the message, never auto-execute without the user's go-ahead implicit in the
request.

## Load Order

1. `CLAUDE.md` — `## Conventions` (commit message format) and
   `## Safety rules` (do-not-regress list — useful as a sanity check on the
   staged diff).
2. `docs/RELEASE_CONVENTION.md` only if the change touches `package.json` /
   `package-lock.json` versions or `forge.config.cjs` packaging.
3. Recent `git log` — match the prevailing tone, scope names, and message
   length already in this repo's history.

## Message Format

```
type(scope): subject in imperative mood
```

- **type**: `fix`, `feat`, `chore`, `docs`, `refactor`, `test`, `style`,
  `perf`.
- **scope**: one or two words naming the subsystem touched
  (e.g. `studio`, `pitch-deck`, `electron`, `skills`, `r2`, `picker`,
  `release`, `jobs`). Pick a scope that already appears in `git log` when
  possible.
- **subject**: imperative ("add", "fix", "drop"), lower-case, no trailing
  period, ≤ ~70 chars.
- **Doc-only changes** → `docs(scope): …`. **Pure refactors** →
  `refactor(scope): …`.

Add a body only when the *why* isn't obvious from the diff. Keep it tight;
this repo's history favours short single-line messages.

## Staging Rules (Safety)

- **Stage by path, not `-A` / `.`.** `git add` only the files the user
  asked about. Use `git status --short` first to surface unrelated dirty
  files and explicitly leave them out (or ask the user if they should be
  bundled — they almost never should).
- **Never `--no-verify`, `--no-gpg-sign`, `--amend`.** A failing hook means
  fix the underlying issue and create a new commit.
- **Don't include generated runtime artefacts** (`runtime/`, fixtures,
  `out/`, `_site/` when not the source). Per `CLAUDE.md` safety rules.
- **Don't commit anything that looks like a secret.** `.env*`, anything
  matching `*api*key*`, `R2_APP_PASSWORD`, etc. Refuse and flag.
- **Don't auto-commit on a whim** — the user must have asked for a commit
  this turn. A user approving one commit doesn't approve future ones.

## Procedure

1. `git status --short` and `git diff --stat` to see what's staged and what
   isn't.
2. If unrelated dirty files exist, list them to the user before staging.
3. Stage only the relevant paths: `git add path/one path/two`.
4. Draft the message using the HEREDOC form (preserves formatting and
   appends the Claude attribution line):

```bash
git commit -m "$(cat <<'EOF'
type(scope): subject

Optional one-paragraph body explaining why (omit if the subject says it all).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

5. `git status --short` after to confirm a clean tree (or just the
   intentionally-left-out files).
6. **Do not push.** The user pushes when they're ready (or asks
   `weatherv1-release` to do it for tagged releases).

## Release Commits

Release commits follow `docs/RELEASE_CONVENTION.md` exactly: bump
`package.json` and `package-lock.json` together, message
`chore(release): v0.1.x`, then a separate `git tag v0.1.x` and push branch
+ tag in the same `git push` invocation. The `weatherv1-release` skill
drives this end-to-end — defer to it for tagged releases instead of
hand-rolling the sequence here.

## Default Checks

- `git status --short` before staging (avoid bundling dirty work).
- `git diff --cached` before invoking commit (read what you're about to
  ship).
- For code changes: the verification commands from `CLAUDE.md`'s
  "Verification defaults" — `npx tsc --noEmit`, `npm test`, `npm run
  build` when routes/build behaviour changed. Don't commit code that
  hasn't passed its category's checks.

## What This Skill Does Not Do

- Push to origin. Out of scope; the user pushes.
- Open a PR (`gh pr create`). Out of scope here — use the standard
  pull-request workflow.
- Tag releases. That's `weatherv1-release`.
- Squash, rebase, or amend history. Out of scope; raise to the user first.
