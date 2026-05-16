# WeatherV1 Cloudflare Infrastructure

Pulumi TypeScript project for the WeatherV1 R2 asset layer.

**Related project docs:** [`docs/R2_PULUMI_HANDOFF.md`](../../docs/R2_PULUMI_HANDOFF.md) (Worker behavior, app sync, live status) · [`docs/DOCS_INDEX.md`](../../docs/DOCS_INDEX.md#cloudflare-r2-optional-cloud-mirror) (full R2 doc map).

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
