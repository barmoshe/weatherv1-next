# WeatherV1 Cloudflare Infrastructure

Pulumi TypeScript project for the WeatherV1 R2 asset layer.

**Related project docs:** [`docs/R2_PULUMI_HANDOFF.md`](../../docs/R2_PULUMI_HANDOFF.md) (object keys, decisions, risks) · [`docs/CLOUDFLARE_INTEGRATION.md`](../../docs/CLOUDFLARE_INTEGRATION.md) (Cloudflare entry-point + MCP).

## Resources

- R2 bucket, default `weatherv1-media`
- R2 lifecycle rule that aborts incomplete multipart uploads after 24 hours
- Optional R2 CORS when `allowedOrigin` is not `*`
- Worker gateway with an R2 bucket binding
- Optional Worker route when `zoneId` and `routePattern` are set

## Required Config

```bash
pulumi config set accountId <cloudflare-account-id>
pulumi config set appUsername <chosen-username>           # plain text, defaults to "weatherv1"
pulumi config set --secret appPassword <chosen-password>  # used by the desktop app to sign in
pulumi config set --secret cloudflareApiToken <cloudflare-api-token-with-r2-temp-credential-access>
pulumi config set --secret r2ParentAccessKeyId <r2-parent-access-key-id>
```

The Worker enforces HTTP Basic Auth against `WEATHERV1_APP_USERNAME` /
`WEATHERV1_APP_PASSWORD`. Both are bound as Worker secrets. The desktop app
sends them as `Authorization: Basic base64(user:pass)`; comparison is
constant-time via `crypto.subtle.timingSafeEqual`.

**Public `/downloads/*` route.** The Worker also exposes an unauthenticated
`GET`/`HEAD` `/downloads/*` route that serves R2 objects under the
`downloads/` key prefix, with strict path whitelisting (`[A-Za-z0-9._/-]+`,
no `..`, no `//`, ≤256 chars). Used today by the public download page for
`downloads/windows/latest/WeatherV1-Setup.exe` and the per-tag
`downloads/windows/<tag>/WeatherV1-Setup.exe`. Mutable `latest/` and
`latest-stable/` pointers get a 5-minute cache; immutable per-version keys
get a 1-year `immutable` cache. Temp credentials minted by
`/v1/r2/temporary-credentials` are scoped to `tenants/<id>/` only, so they
can never read or overwrite anything under `downloads/`.

To migrate from a previous deploy that used a single `appToken`:

```bash
pulumi config rm appToken
pulumi config set appUsername <chosen-username>
pulumi config set --secret appPassword <chosen-password>
pulumi up
```

## Optional Config

```bash
pulumi config set bucketName weatherv1-media
pulumi config set tenantId default
pulumi config set workerName weatherv1-r2-gateway
pulumi config set workersDevSubdomain <account-workers-dev-subdomain-without-.workers.dev>
pulumi config set allowedOrigin http://127.0.0.1:3765
pulumi config set zoneId <zone-id>
pulumi config set routePattern r2.example.com/*
pulumi config set r2Location weur
pulumi config set r2StorageClass Standard
```

## Commands

```bash
npm install
npm run typecheck
npm run preview
npm run up
```

## `Pulumi.dev.yaml` and committed secrets

`Pulumi.dev.yaml` is checked into the repo with **encrypted** values for
every `--secret` key. This is the [documented Pulumi pattern](https://www.pulumi.com/docs/iac/concepts/secrets/):
each stack has its own salt (`encryptionsalt` at the top of the file)
and the per-key `secure: <ciphertext>` blocks are useless without it.
Pulumi Cloud (or the operator's local passphrase) holds the decryption
key.

Practical implications:

- Committing the file is safe; **do not** commit a `.pulumi/` directory
  or any plaintext `.env` values.
- Rotating a secret means re-running `pulumi config set --secret <key>
  <new-value>` and committing the resulting `Pulumi.<stack>.yaml` diff.
- The `cloudflare:apiToken` entry is the **provider's** auth token, not
  the Worker's runtime token — see the section below.

### Passphrase ownership

The decryption passphrase for `Pulumi.dev.yaml` is **operator-local
today** — held by the repo maintainer in a password manager. There is
no CI workflow that runs `pulumi up`; the operator runs it from their
machine. (An earlier audit phase proposed a CI workflow for `pulumi
preview` / `pulumi up`; it was removed in favor of keeping infra
changes operator-driven.)

Rotation: `pulumi --cwd infra/cloudflare stack change-secrets-provider
passphrase` re-encrypts every `secure:` value under a new salt. Commit
the resulting `Pulumi.<stack>.yaml` diff.

## `cloudflare:apiToken` vs `cloudflareApiToken`

`Pulumi.dev.yaml` carries two superficially similar tokens. They do
different things:

| Key | Used by | Purpose |
| --- | --- | --- |
| `cloudflare:apiToken` | The Pulumi **Cloudflare provider** itself | Mutates Cloudflare resources during `pulumi up` (creates R2 buckets, deploys Workers, etc.) |
| `weatherv1-cloudflare:cloudflareApiToken` | The **Worker** at request time | Calls `POST /accounts/<id>/r2/temp-access-credentials` to mint short-lived R2 creds for the desktop app |

They can be the same physical Cloudflare API token, but it is safer to
issue two tokens with the minimum scopes each needs:

- **Provider token:** Account R2:Edit, Workers Scripts:Edit, Workers
  Routes:Edit on the target account.
- **Worker runtime token:** Account R2:Edit (specifically the
  `r2/temp-access-credentials` permission) on the bucket only.

Rotation: rotate independently. The provider token has blast radius
(`pulumi up` privileges); the runtime token only mints scoped R2 creds.

## Promoting `dev` → `prod`

A template config lives at [`Pulumi.prod.yaml.example`](Pulumi.prod.yaml.example).
Pulumi does **not** load this file as a stack until it is renamed.

```bash
# 1. Copy the template and fill in REPLACE_ME values
cp infra/cloudflare/Pulumi.prod.yaml.example infra/cloudflare/Pulumi.prod.yaml
# (edit the file to replace REPLACE_ME placeholders for non-secret keys)

# 2. Initialize the stack
pulumi --cwd infra/cloudflare stack init prod
pulumi --cwd infra/cloudflare stack select prod

# 3. Set every --secret value via the CLI so Pulumi encrypts each one
#    under the new stack's salt. DO NOT paste plaintext secrets into the
#    YAML file.
pulumi --cwd infra/cloudflare config set --secret appPassword <new-pw>
pulumi --cwd infra/cloudflare config set --secret cloudflareApiToken <token>
pulumi --cwd infra/cloudflare config set --secret r2ParentAccessKeyId <id>
pulumi --cwd infra/cloudflare config set --secret cloudflare:apiToken <provider-token>

# 4. Preview and apply
pulumi --cwd infra/cloudflare preview
pulumi --cwd infra/cloudflare up
```

Use a distinct `bucketName` and `workerName` from the `dev` stack so the
two stacks never share resources.

## Secrets ownership & rotation

Canonical inventory of every secret the project touches. Three categories:
**CI/build-time** (GitHub Actions Secrets), **infrastructure** (Pulumi-encrypted
YAML), and **runtime user** (Electron `safeStorage`, never in repo).

### Inventory

| Secret | Store | Consumer | Blast radius |
| --- | --- | --- | --- |
| `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`, `OSX_SIGN_IDENTITY` | Operator-local (`.env` for `npm run electron:make` on a developer Mac) | Notarization for the locally-built macOS zip per [`docs/RELEASE_CONVENTION.md`](../../docs/RELEASE_CONVENTION.md). Not used in CI. | Notarization identity; revocable in Apple Developer portal |
| `CLOUDFLARE_API_TOKEN` | GitHub Secrets | `.github/workflows/pitch-deck.yml` (Pages deploy via `cloudflare/wrangler-action`) | Cloudflare Pages:Edit on the account |
| `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_ENDPOINT` | GitHub Secrets | `.github/workflows/desktop-publish-release.yml` (`aws s3 cp` of the Windows installer via R2's S3 endpoint) | S3-style R2 credentials, Object Read & Write scoped to bucket `weatherv1-media`. Issued via Cloudflare dashboard → R2 → Manage R2 API Tokens. Wrangler's `r2 object put` caps at 300 MiB; the installer is ~437 MiB, so aws-cli's S3 multipart is required. |
| `CLOUDFLARE_ACCOUNT_ID` | GitHub Secrets | Both workflows above | Identifier, not a secret in the credential sense |
| `EDITOR_PASSWORD`, `ADMIN_PASSWORD` | GitHub Secrets | `.github/workflows/desktop.yml` env → `scripts/emit-auth-hashes.cjs` (Argon2id at prebuild) → gitignored `auth-passwords.generated.ts` | App-level gate credentials baked into the installer |
| `GITHUB_TOKEN` | Auto-injected per run | All workflows | Repo-scoped; nothing to rotate |
| Pulumi passphrase | Operator-local (password manager) | `pulumi` CLI when the operator runs it locally | Decrypts every `secure:` value in `Pulumi.dev.yaml` — full Worker/R2 credential exposure. **Not in GitHub Secrets**; CI does not run `pulumi`. |
| `cloudflare:apiToken` | `Pulumi.dev.yaml` (encrypted) | Pulumi Cloudflare provider during `pulumi up` | Mutates Cloudflare resources |
| `weatherv1-cloudflare:cloudflareApiToken` | `Pulumi.dev.yaml` (encrypted) | Worker runtime — mints temp R2 creds | Scoped to `r2/temp-access-credentials` |
| `weatherv1-cloudflare:r2ParentAccessKeyId` | `Pulumi.dev.yaml` (encrypted) | Worker runtime — parent R2 key | R2 read/write parent |
| `weatherv1-cloudflare:appPassword` | `Pulumi.dev.yaml` (encrypted) | Worker runtime — Basic-Auth for the desktop app | Lets an attacker mint temp R2 creds via the gateway |
| `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY` | Electron `safeStorage` (per-user) | `electron/main.cjs` → child env via `electron/config.cjs` | Per-user; out of scope for repo-level rotation |
| `R2_APP_USERNAME`, `R2_APP_PASSWORD` | Electron `safeStorage` (per-user) | `electron/config.cjs` | Per-user; out of scope for repo-level rotation |
| Per-launch desktop session token | Main-process memory, ephemeral | `electron/main.cjs`, `src/proxy.ts`, `src/server/runtime/auth.ts` | Process-lifetime only |

Owner of every repo-level secret above: the WeatherV1 maintainer.

### Rotation procedures

**Anything in GitHub Secrets:**

```bash
gh secret set <NAME>
```

`gh` prompts for the new value. Re-run the relevant workflow afterwards
to pick it up. Do not paste a `# comment` after the command — interactive
zsh treats `#` as a literal argument unless `setopt interactive_comments`
is set, and `gh secret set` will reject the extra words.

**`EDITOR_PASSWORD` / `ADMIN_PASSWORD`:** rotation is `gh secret set <NAME>` followed by a fresh tag build. The Argon2id hash is re-minted on every build; nothing to clean up in the source tree.

**Apple signing secrets (operator-local):** rotate the app-specific password at <https://appleid.apple.com> → Sign-In and Security → App-Specific Passwords. Update the operator's local `.env` and re-run `npm run electron:make` on the Mac. `APPLE_TEAM_ID` and `APPLE_ID` rarely change. Not in GitHub Secrets — macOS builds happen locally only.

**Cloudflare tokens** — issue replacements as follows, then `gh secret set <NAME>`:

- `CLOUDFLARE_API_TOKEN` (Pages deploy): <https://dash.cloudflare.com/profile/api-tokens>, Cloudflare Pages:Edit.
- `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` / `R2_ENDPOINT` (S3-style, for `aws s3 cp` of the installer): Cloudflare dashboard → R2 → **Manage R2 API Tokens** → Object Read & Write scoped to bucket `weatherv1-media`. Cloudflare shows the secret access key once at creation.
- `cloudflare:apiToken` and `weatherv1-cloudflare:cloudflareApiToken` (Pulumi-stored): re-encrypt and apply per the snippet below.

None of the GitHub Actions secrets need a Pulumi reapply. For Pulumi-stored tokens:

```bash
pulumi --cwd infra/cloudflare config set --secret cloudflareApiToken <new-token>
git commit -am "chore(infra): rotate cloudflareApiToken"
pulumi --cwd infra/cloudflare up
```

**`weatherv1-cloudflare:appPassword`:** rotate via Pulumi the same way, then redistribute to end users out-of-band (it is the Worker gateway Basic-Auth secret).

**`r2ParentAccessKeyId` (+ paired secret):** in Cloudflare dashboard → R2 → "Manage R2 API Tokens", issue a new parent key, update the Pulumi secret, `pulumi up`, then revoke the old key.

**Pulumi passphrase (operator-local):**

```bash
pulumi --cwd infra/cloudflare stack change-secrets-provider passphrase
# Pulumi prompts for the OLD passphrase, then the NEW one. Every `secure:`
# value in Pulumi.<stack>.yaml gets re-encrypted under the new salt.
git commit -am "chore(infra): rotate Pulumi passphrase"
# Update the operator's password manager. No GitHub Secret to update.
```

**Runtime user secrets** (Electron `safeStorage`-stored API keys, R2 Basic-Auth): out of scope — the end user rotates them from inside the Settings UI. The repo holds no copy.

### Where the Pulumi passphrase lives

Operator-local today: held by the repo maintainer in a password manager. The decryption passphrase is **not** committed and **not** stored in Pulumi Cloud.

If the operator's copy is lost, every `secure:` value in `Pulumi.dev.yaml` becomes unrecoverable. Recovery means rotating each secret at the source (issue new Cloudflare tokens, redistribute `appPassword` to users) and re-encrypting under a new passphrase.
