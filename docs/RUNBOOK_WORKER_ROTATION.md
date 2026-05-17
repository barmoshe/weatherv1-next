# Runbook — rotate Worker secrets

The R2 gateway Worker (`weatherv1-r2-gateway`) authenticates the desktop
app via HTTP Basic. The username + password pair lives in two places:

- GitHub secret `EDITOR_PASSWORD` (canonical) — also used as the local
  editor login secret. `R2_APP_USERNAME` is optional; defaults to
  `v1editor`.
- Worker secret bindings `WEATHERV1_APP_USERNAME` and
  `WEATHERV1_APP_PASSWORD` — set by CI from the GitHub secrets above.

## Rotate

1. Update the GitHub secret:
   ```bash
   gh secret set EDITOR_PASSWORD --body 'NEW-PASSWORD'
   ```
2. Push the new value to the Worker:
   ```bash
   gh workflow run rotate-worker-secrets.yml
   gh run watch  # wait for the dispatched run to finish
   ```
   The workflow uses `wrangler secret bulk` and then curls
   `/v1/catalog` with the new password to confirm.
3. Tag and ship a new desktop release so installers ship the matching
   build (`/weatherv1-release` or the manual flow at
   [docs/RELEASE_CONVENTION.md](RELEASE_CONVENTION.md)). Existing
   installed apps will keep working as long as the user re-enters the
   new password on next login.

## Verify manually

```bash
PASS=$(gh secret list  # …obviously gh can't read secrets; paste manually
USER=v1editor
curl -sS -o /dev/null -w '%{http_code}\n' \
  -u "$USER:$PASS" \
  https://weatherv1-r2-gateway.barprojectsandbuilds.workers.dev/v1/catalog?tenantId=default
# expect 200
```

## Deploy the Worker code

[.github/workflows/worker-deploy.yml](../.github/workflows/worker-deploy.yml)
auto-deploys on pushes to `main` that touch `infra/cloudflare/worker/**`
or `infra/cloudflare/wrangler.toml`. For an out-of-band deploy:

```bash
gh workflow run worker-deploy.yml
```

## Why not Pulumi anymore?

Pulumi previously owned the Worker resource, but the state lives only on
whichever operator machine ran the last `pulumi up`. A fresh CI runner
or a different laptop sees an empty state file and tries to *create* the
Worker — 409 Conflict — so rotation became a multi-step manual chore.

Wrangler reads the Worker config from `infra/cloudflare/wrangler.toml`,
which is committed; secrets are pushed independently via `wrangler secret
bulk`. Stateless deploys, idempotent rotation, no operator hand-off
required.

Pulumi still owns the R2 bucket + lifecycle and the Pages project — those
are deploy-once resources and the state isn't on the critical path.
