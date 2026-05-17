# Archived: Secrets-Management Audit & GitHub-Secrets Migration

> **Phases 0, 1, 2, 4 shipped. Phase 3 (CI `pulumi up`) deliberately
> reverted** — see the Phase 3 section below. See
> [`../../infra/cloudflare/README.md`](../../infra/cloudflare/README.md#secrets-ownership--rotation)
> for the live secret inventory and rotation playbook. This file is kept
> for the design rationale behind the current model.

**Status:** archived. Touched every credential the project handles —
build-time, CI, Pulumi, and runtime. Shipped phased so each phase landed
independently.

**Related:**
[`EDITOR_AND_ADMIN_GATES.md`](EDITOR_AND_ADMIN_GATES.md) (carries the
EDITOR/ADMIN sub-plan; this doc is the umbrella) ·
[`../R2_PULUMI_HANDOFF.md`](../R2_PULUMI_HANDOFF.md) ·
[`../CLOUDFLARE_INTEGRATION.md`](../CLOUDFLARE_INTEGRATION.md) ·
[`../../infra/cloudflare/README.md`](../../infra/cloudflare/README.md) ·
[`../RELEASE_CONVENTION.md`](../RELEASE_CONVENTION.md).

## Goal

One canonical, documented model for every secret in the project:

- **CI/build-time secrets** live in **GitHub Actions Secrets**, wired into
  workflows via `secrets.*`, and consumed by prebuild scripts that never
  echo plaintext or derived values.
- **Infrastructure secrets** (Pulumi) stay encrypted in `Pulumi.<stack>.yaml`,
  with the **decryption passphrase** itself stored as a GitHub Secret so
  `pulumi up` can run from CI without an operator on the loop.
- **Runtime user secrets** (per-user API keys, R2 Basic-Auth) stay in
  Electron `safeStorage` — never moved to GitHub, never logged.
- Every secret has a documented **owner**, **rotation procedure**, and
  **blast radius** in this doc and (where relevant) in
  `infra/cloudflare/README.md`.

## Research Summary

### Current inventory

| Secret | Where it lives today | Used by | Notes |
| --- | --- | --- | --- |
| `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`, `OSX_SIGN_IDENTITY` | GitHub Secrets | `.github/workflows/desktop.yml:31-34`, consumed by `forge.config.cjs:32-45` for notarization | macOS dropped from CI matrix (`desktop.yml:25-28` only lists `windows-latest`). Wired but currently dead. |
| `WIN_CERT_FILE`, `WIN_CERT_PASSWORD` | GitHub Secrets | `.github/workflows/desktop.yml:35-36`, consumed by `forge.config.cjs:36-37,131` for signing | `forge.config.cjs:25-26` documents a `WIN_CERTIFICATE_BASE64` → `WIN_CERT_FILE` decode step. **Workflow does not perform the decode** — gap. |
| `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | GitHub Secrets | `.github/workflows/pitch-deck.yml:45-46`, `cloudflare/wrangler-action` | Pages deploy only. Separate from Pulumi provider token. |
| `GITHUB_TOKEN` | Auto-injected | `ci.yml`, `pitch-deck.yml`, `desktop-publish-release.yml` | Standard GitHub-provided token. Nothing to change. |
| `cloudflare:apiToken` | `Pulumi.dev.yaml` (encrypted) | Pulumi Cloudflare provider during `pulumi up` | Plaintext lives only in operator's machine + Pulumi backend. No CI consumer today. |
| `weatherv1-cloudflare:cloudflareApiToken` | `Pulumi.dev.yaml` (encrypted) | Worker at runtime — mints temp R2 creds | Same shape as above, distinct token. |
| `weatherv1-cloudflare:r2ParentAccessKeyId` | `Pulumi.dev.yaml` (encrypted) | Worker at runtime — parent R2 key | Same as above. |
| `weatherv1-cloudflare:appPassword` | `Pulumi.dev.yaml` (encrypted) | Worker at runtime — Basic-Auth for desktop app | Default `weatherv1`. Distributed to end users out-of-band. |
| Pulumi passphrase | Operator-local (or Pulumi Cloud) | Decrypts `Pulumi.<stack>.yaml` | **Undocumented where it lives**. Lose this → can't `pulumi up`. |
| `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY` | Electron `safeStorage` (per-user) | `electron/main.cjs:389-396`, injected into child env in `electron/config.cjs:211-213` | Web mode reads from `.env`. Correct as-is. |
| `R2_APP_USERNAME`, `R2_APP_PASSWORD` | Electron `safeStorage` (per-user) | `electron/config.cjs:256-257` | Collected by `StorageOnboardingGate.tsx`. Correct as-is. |
| Per-launch desktop session token | Main-process memory + injected request header | `electron/main.cjs`, `src/proxy.ts`, `src/server/runtime/auth.ts` | Ephemeral per process. Correct as-is. |
| **NEW** `EDITOR_PASSWORD`, `ADMIN_PASSWORD` | Does not exist yet | Proposed: GitHub Secrets → prebuild Argon2id → gitignored `auth-passwords.generated.ts` | Spec in [`EDITOR_AND_ADMIN_GATES.md`](EDITOR_AND_ADMIN_GATES.md) lines 117-178. |
| **NEW** `CI_EDITOR_PASSWORD`, `CI_ADMIN_PASSWORD` | Does not exist yet | Proposed: GitHub Secrets → `.github/workflows/ci.yml` env → end-to-end gate tests | Same source doc. |

### Risks and gaps the audit surfaced

1. **`WIN_CERT_FILE` decode step is missing.** `desktop.yml:35` expects a
   *file path*, but `forge.config.cjs:25-26` says the convention is a
   base64-encoded `.pfx` decoded to a temp file at the start of the job.
   Today, a real Windows signing run would fail — the secret is wired but
   the path it points to does not exist.
2. **macOS signing secrets are dead weight.** `desktop.yml:25-28` only
   builds Windows. `APPLE_*` and `OSX_SIGN_IDENTITY` are exported into the
   env on every run but never consumed. They are not a leak (still masked)
   but they hide the truth: no notarized macOS build ships from CI today.
3. **Pulumi passphrase has no documented home.** Anyone trying to run
   `pulumi up` from a fresh checkout has to guess where it came from. If
   it is in Pulumi Cloud, that should be the single sentence in
   `infra/cloudflare/README.md`. If it is operator-local, the lone
   operator is a bus-factor risk.
4. **`Pulumi.dev.yaml` encryption salt is committed.** That is the
   documented Pulumi pattern (`infra/cloudflare/README.md:62-69`) and
   safe per design — the salt is useless without the passphrase — but it
   means we are one passphrase leak from full Worker-credential exposure.
5. **No CI assertion that secrets are set.** A misconfigured secret
   silently ships an unsigned installer with no warning. There is no
   "fail loud if `WIN_CERT_PASSWORD` is empty on a tag build" guardrail.
6. **No rotation playbook.** Each secret has its own rotation path
   (GitHub UI, Apple Developer portal, Cloudflare dashboard, Pulumi CLI),
   but they are not collected anywhere a future maintainer can find them.
7. **`EDITOR_PASSWORD`/`ADMIN_PASSWORD` pipeline doesn't exist yet.**
   Greenfield — no `argon2` dependency, no `scripts/emit-auth-hashes.cjs`,
   no `prebuild` hook, no gitignored generated file, no workflow env. The
   Editor Gates feature is blocked on this infra slice.

### Best-practice notes

- **GitHub Secrets** are encrypted at rest with libsodium sealed boxes,
  decrypted only into the per-job runner env, and masked in logs. They
  are the right home for any value the project needs at build/CI time.
  Source: https://docs.github.com/en/actions/security-guides/encrypted-secrets.
- **Masking is brittle for derived values.** GitHub auto-masks the
  literal secret bytes, not values *computed* from them. Any prebuild
  step that hashes/signs/encodes a secret must avoid `echo`/`console.log`
  of the derived value. Source: https://docs.github.com/en/actions/security-guides/security-hardening-for-github-actions#using-secrets.
- **Pulumi-encrypted YAML with a Cloud-stored passphrase** is OWASP-safe
  for IaC: the salt-per-stack design means the committed ciphertext is
  worthless without the Cloud passphrase. The same encryption salt
  layout we already use (`infra/cloudflare/Pulumi.dev.yaml:1`) is the
  documented Pulumi pattern. Source: https://www.pulumi.com/docs/iac/concepts/secrets/.
- **Pulumi passphrase in GitHub Secrets + `PULUMI_CONFIG_PASSPHRASE` env**
  is the standard way to run `pulumi up` from Actions. The passphrase
  itself never appears in workflow files. Source: https://www.pulumi.com/docs/iac/cli/environment-variables/#pulumi_config_passphrase.
- **Code-signing certs as base64 secrets** is the documented path for
  `electron/notarize` and Forge on Actions: a single `*_BASE64` secret +
  a workflow step that decodes to a temp file and exports `*_FILE`.
  Source: https://www.electron.build/code-signing#windows.

## Decisions

1. **GitHub Secrets is the canonical store for everything CI consumes.**
   That covers code-signing certs, Cloudflare deploy tokens, Pulumi
   passphrase (new), `EDITOR_PASSWORD`/`ADMIN_PASSWORD` (new), and CI-only
   test variants.
2. **Runtime user secrets stay in `safeStorage`.** Out of scope — those
   are per-user, never canonical anywhere in the repo.
3. **Pulumi-encrypted YAML stays as-is.** The committed ciphertext is
   the right shape; the decryption passphrase is what gets promoted to a
   GitHub Secret so `pulumi up` becomes CI-runnable later.
4. **EDITOR/ADMIN passwords are stored plaintext in GitHub Secrets.** A
   prebuild script hashes them to Argon2id at build time and writes a
   gitignored generated file. Rotation = edit secret in GitHub UI →
   re-run workflow. No local hashing, no committed hash. This is the
   plan already settled in
   [`EDITOR_AND_ADMIN_GATES.md`](EDITOR_AND_ADMIN_GATES.md) lines 117-178
   — restated here for completeness.
5. **No new secret stores.** Specifically: no 1Password Connect, no
   AWS/GCP Secret Manager, no Doppler/Infisical/etc. Adds operational
   burden without solving a problem the GitHub + Pulumi pair leaves open.

## Implementation Plan

Phases ship independently and in this order. Each phase is a separate
PR; later phases assume earlier ones are merged but the work doesn't
overlap.

### Phase 0 — Documentation & inventory (no code)

| File | Change |
| --- | --- |
| `infra/cloudflare/README.md` | New "Secrets ownership & rotation" section: one table mirroring the Current Inventory above, plus per-secret rotation steps. Document where the Pulumi passphrase lives (Pulumi Cloud vs operator). |
| `docs/RELEASE_CONVENTION.md` | New "Required GitHub Secrets" subsection under release preflight. List every `secrets.*` consumed by `desktop.yml` + `desktop-publish-release.yml` with a one-line description. |
| `docs/DOCS_INDEX.md` | Add a "Manage a secret" row under "Pick the right doc by task" pointing at this file and the Pulumi README. |

**Verification:** doc-only; `npx tsc --noEmit` is unaffected. Reviewer
walks the inventory table against `grep -rn secrets\\. .github/`.

### Phase 1 — `EDITOR_PASSWORD` / `ADMIN_PASSWORD` build-time pipeline

Implements the slice in
[`EDITOR_AND_ADMIN_GATES.md`](EDITOR_AND_ADMIN_GATES.md) lines 119-178.
Can land **before** the rest of Editor Gates (login UI, settings
redesign), since the generated file just sits unused until the verify
functions consume it.

| File | Change |
| --- | --- |
| `package.json` | Add `argon2` dependency. Add `"prebuild": "node scripts/emit-auth-hashes.cjs"` script. |
| `scripts/emit-auth-hashes.cjs` | New. Reads `EDITOR_PASSWORD` / `ADMIN_PASSWORD` from `process.env`; calls `argon2.hash(value, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 })`; writes `src/server/runtime/auth-passwords.generated.ts`. Hard-fails in `NODE_ENV=production` or `CI=true` if either env var is missing. In local dev with both unset, falls back to a known dev password (`devdev`) and prints a loud one-line banner. **Never logs the plaintext or the hash.** |
| `scripts/hash-password.cjs` | New, optional. Prompts (TTY, no echo) for a password and prints the Argon2id hash to stdout — debugging-only helper for "does this plaintext hash to that value?" questions. Not part of any automated flow. |
| `src/server/runtime/auth-passwords.generated.ts` | Generated at build time. **Gitignored.** Two exports: `EDITOR_HASH`, `ADMIN_HASH`. |
| `src/server/runtime/auth-passwords.ts` | New, hand-written. Imports the generated file. Exports `verifyEditorLogin(username, password)` (uses `crypto.timingSafeEqual` for the username compare against `"v1editor"`, then `argon2.verify(EDITOR_HASH, password)`) and `verifyAdminPassword(password)` (just `argon2.verify`). |
| `.gitignore` | Add `src/server/runtime/auth-passwords.generated.ts`. |
| `.env.example` | Document `EDITOR_PASSWORD` and `ADMIN_PASSWORD` (plaintext; the prebuild step hashes them automatically). |
| `.github/workflows/desktop.yml` | Extend the `env:` block at lines 30-37 with `EDITOR_PASSWORD: ${{ secrets.EDITOR_PASSWORD }}` and `ADMIN_PASSWORD: ${{ secrets.ADMIN_PASSWORD }}`. These are consumed by the `prebuild` invoked from `npm run build` in the package + make steps (lines 53-59). |
| `.github/workflows/ci.yml` | Extend the test job env with `EDITOR_PASSWORD: ${{ secrets.CI_EDITOR_PASSWORD }}` and `ADMIN_PASSWORD: ${{ secrets.CI_ADMIN_PASSWORD }}` so future gate tests run end-to-end without leaking the real passwords. |
| `src/test/auth-passwords.test.ts` | New. `verifyEditorLogin` rejects wrong username, wrong password, accepts both right. `verifyAdminPassword` accepts right, rejects wrong. Uses a known dev-password fallback so the test does not depend on Secrets being set. |
| `forge.config.cjs` | No change. `@electron-forge/plugin-auto-unpack-natives` already unpacks `argon2` (native module) the same way it handles `ffmpeg-static`. |

**GitHub Secrets to add (manual step, one-time):**

```bash
gh secret set EDITOR_PASSWORD     --app actions
gh secret set ADMIN_PASSWORD      --app actions
gh secret set CI_EDITOR_PASSWORD  --app actions
gh secret set CI_ADMIN_PASSWORD   --app actions
```

**Verification:**

```bash
EDITOR_PASSWORD=devdev ADMIN_PASSWORD=devdev npm run prebuild
npx tsc --noEmit
npm test -- src/test/auth-passwords.test.ts
npm run build                                     # full build exercises prebuild
grep -r "devdev" .next out 2>/dev/null && echo "FAIL: plaintext in bundle"
grep -r "$EDITOR_HASH" src/ scripts/ 2>/dev/null  # only the generated file should match
```

After a real CI run, scrub the build-step log for:
- the plaintext password (should never appear — Actions auto-masks),
- the Argon2 hash output (must not appear — script is silent by design).

### Phase 2 — Code-signing audit

| File | Change |
| --- | --- |
| `.github/workflows/desktop.yml` | Add a guard step before the make step: if `${{ github.ref_type == 'tag' }}` and `WIN_CERT_FILE` env is empty, `exit 1` with a clear error. Same for `EDITOR_PASSWORD` / `ADMIN_PASSWORD`. |
| `.github/workflows/desktop.yml` | Rename the existing `WIN_CERT_FILE` secret to `WIN_CERTIFICATE_BASE64` (matches `forge.config.cjs:25` convention). Add a "Decode Windows cert" step that writes `${{ secrets.WIN_CERTIFICATE_BASE64 \| base64 -d }}` to a temp `.pfx` and exports `WIN_CERT_FILE=<temp path>` for subsequent steps. |
| `.github/workflows/desktop.yml` | Remove the `APPLE_*` / `OSX_SIGN_IDENTITY` env entries since macOS isn't in the matrix. Keep the secrets defined in the repo for the day macOS comes back; just don't export them into every Windows job. |
| `forge.config.cjs` | Drop the inline comment block at lines 22-26 (now lives in `docs/RELEASE_CONVENTION.md`). |

**GitHub Secrets to add/rotate (manual):**

```bash
# If WIN_CERT_FILE was set as a path-pretending-to-be-a-secret, replace it:
base64 -i path/to/cert.pfx | gh secret set WIN_CERTIFICATE_BASE64 --app actions
gh secret delete WIN_CERT_FILE --app actions
```

**Verification:** push a `v0.0.0-signtest` tag to a throwaway branch;
confirm `WeatherV1-Setup.exe` is signed (right-click → Properties →
Digital Signatures on Windows, or `osslsigncode verify` from a Linux
runner).

### Phase 3 — Pulumi passphrase via GitHub Secrets (NOT shipped — reverted)

This phase proposed an `.github/workflows/infra.yml` that would run
`pulumi preview` on PRs and `pulumi up --yes` on `main`, reading the
passphrase from `secrets.PULUMI_CONFIG_PASSPHRASE`. It was briefly
landed and then removed: the project's Pulumi backend is Pulumi Cloud
(also requires `PULUMI_ACCESS_TOKEN`), and the maintainer decided
operator-driven `pulumi up` is preferable for this single-operator
project.

The passphrase remains operator-local — see
[`../../infra/cloudflare/README.md`](../../infra/cloudflare/README.md#passphrase-ownership).
Revisit this phase only if multi-operator infra changes via PR become a
real need.

### Phase 4 — Cleanup

| File | Change |
| --- | --- |
| `docs/future/SECRETS_MANAGEMENT_AUDIT.md` | Move to `docs/archive/` when all phases above are merged. |
| `docs/future/README.md` | Remove this file's row. |
| `docs/future/EDITOR_AND_ADMIN_GATES.md` | Trim the Phase 1 (Shared password infrastructure) section down to a one-paragraph cross-reference to `docs/archive/SECRETS_MANAGEMENT_AUDIT.md`. The Editor Gates UI plan stays intact. |

## Verification (cross-phase)

Standard verification stack on every phase:

```bash
npx tsc --noEmit
npm test
npm run build
```

Cross-cutting checks after each phase:

- **No plaintext in the bundle.** `grep -r "$EDITOR_PASSWORD" .next out`
  must return nothing. Same for any other secret value used at build time.
- **No derived hash in the source tree.** `grep -r "$argon_hash" src/`
  must only hit `auth-passwords.generated.ts` (which is gitignored, so
  `git ls-files` excludes it).
- **CI log hygiene.** Open the workflow's "Prebuild" / build / make step
  logs after a real run; confirm neither plaintext nor any derived hash
  appears.
- **Rotation drill.** For each migrated secret, rotate it once via the
  GitHub UI and re-run the relevant workflow; verify the consumer
  (installer, Worker, etc.) picks up the new value without a code change.

## Critical files

See the per-phase tables. The new files introduced across the whole task:

| Path | Action |
| --- | --- |
| `scripts/emit-auth-hashes.cjs` | new — Phase 1 |
| `scripts/hash-password.cjs` | new — Phase 1, optional |
| `src/server/runtime/auth-passwords.ts` | new — Phase 1 |
| `src/server/runtime/auth-passwords.generated.ts` | new (generated, gitignored) — Phase 1 |
| `src/test/auth-passwords.test.ts` | new — Phase 1 |
| `.github/workflows/infra.yml` | ~~new — Phase 3~~ (reverted; never landed permanently) |
| `package.json` | edit (`argon2`, `prebuild`) — Phase 1 |
| `.env.example` | edit — Phase 1 |
| `.gitignore` | edit — Phase 1 |
| `.github/workflows/desktop.yml` | edit — Phases 1 + 2 |
| `.github/workflows/ci.yml` | edit — Phase 1 |
| `infra/cloudflare/README.md` | edit — Phases 0 + 3 |
| `docs/RELEASE_CONVENTION.md` | edit — Phase 0 |
| `docs/DOCS_INDEX.md` | edit — Phase 0 |
| `forge.config.cjs` | edit (comment cleanup) — Phase 2 |

## Reused functions / patterns

- The `secrets.*` → workflow `env:` → process env pattern already used
  for `APPLE_APP_SPECIFIC_PASSWORD` in `.github/workflows/desktop.yml:32`.
  All new secrets follow the same shape — no new infrastructure.
- The Pulumi-encrypted-YAML pattern is already in use
  (`infra/cloudflare/Pulumi.dev.yaml`); Phase 3 only adds a CI consumer.
- `@electron-forge/plugin-auto-unpack-natives` (already configured in
  `forge.config.cjs`) handles `argon2`'s native module without changes.
- Existing logging discipline in `scripts/prepare-standalone.cjs`
  (silent on the happy path, loud on failure) is the template for
  `emit-auth-hashes.cjs`.

## Non-Goals

- **No secrets-vault migration.** No 1Password Connect / AWS Secrets
  Manager / Doppler / Infisical. GitHub Secrets + Pulumi-encrypted YAML
  is the canonical model.
- **No rotation of runtime user secrets** (`OPENAI_API_KEY`,
  `R2_APP_PASSWORD`, etc.). Those are user-provided and stay in
  `safeStorage` — out of scope for repo-level audit.
- **No automatic secret-rotation tooling.** Rotation is documented and
  manual. A scheduled rotator is overkill for this scale.
- **No leak-detection / git-secrets pre-commit hook.** Worth doing
  someday but not load-bearing for this task. Track separately if needed.
- **No re-architecture of the Pulumi stack layout.** `dev` stays as the
  active stack; `prod` template stays as a future-renaming exercise per
  `infra/cloudflare/README.md:101-130`.
- **No mac signing revival.** Phase 2 removes the dead `APPLE_*` env
  entries from `desktop.yml`; bringing macOS back to CI is a separate
  task that would also need the `WINDOWS_INSTALLER_R2_PLAN` work to
  finish first.
- **No change to the Editor Gates UI plan.** Phase 1 implements only the
  build-time hash pipeline. The login screen, settings redesign, and
  IPC session handlers all stay in
  [`EDITOR_AND_ADMIN_GATES.md`](EDITOR_AND_ADMIN_GATES.md) Phases 2-3.
