# [COMPLETED] Handoff — R2 Worker proxy migration + unified auth

**Status:** ✅ shipped end-to-end
**Date archived:** 2026-05-17
**Tags shipped:** `v0.3.5` (refactor), `v0.3.6` (perf fix + docs)
**Plan:** [`/Users/barmoshe/.claude/plans/based-on-all-that-cheeky-wave.md`](file:///Users/barmoshe/.claude/plans/based-on-all-that-cheeky-wave.md)

## Outcome

R2 sync is live. The packaged desktop app pulls the catalog (212 entries
confirmed locally) and uploads/downloads media through the gateway
Worker. The S3 SDK is gone from the app; temp credentials are gone from
the Worker; auth is unified behind a single GH secret.

## What shipped

### v0.3.5 — `a10e24f refactor(r2,auth): proxy R2 through Worker, unify editor credential`

- All R2 I/O moved to Worker routes `/v1/objects` (GET/HEAD/PUT/DELETE)
  and `/v1/multipart/*` (chunked uploads for files >90 MB).
- `src/server/sync/r2/client.ts` rewritten — no AWS SDK, fetch-only.
- `@aws-sdk/client-s3` + `@aws-sdk/lib-storage` removed from
  `package.json`.
- `/v1/r2/temporary-credentials` endpoint and its
  `CLOUDFLARE_API_TOKEN` + `R2_PARENT_ACCESS_KEY_ID` Worker bindings
  deleted.
- Editor login + R2 Worker Basic Auth share GH secret `EDITOR_PASSWORD`
  (Argon2id hash baked into the build; plaintext bound to the Worker).
  Username from GH secret `R2_APP_USERNAME`, default `v1editor`.
- `scripts/emit-r2-defaults.cjs` bakes the plaintext into
  `electron/r2-defaults.generated.cjs` at prebuild → packaged installs
  sync without an onboarding screen.
- `StorageOnboardingGate` reduced to recovery-only.
- `EditorLoginGate` propagates the password to R2 via
  `desktop.saveSettings` on successful sign-in.
- Worker management moved from Pulumi to wrangler
  (`infra/cloudflare/wrangler.toml` + `.github/workflows/worker-deploy.yml`).
- New `.github/workflows/rotate-worker-secrets.yml` for `wrangler secret
  bulk` on dispatch.
- Pulumi config trimmed (`infra/cloudflare/index.ts`, `Pulumi.dev.yaml`).
  Pulumi still owns R2 bucket + lifecycle + Pages.

### v0.3.6 — `dc16641 chore(release): v0.3.6`

- `perf(worker)`: pre-compiled `TENANT_KEY_RE`, `FORBIDDEN_OUTPUTS_RE`,
  `RANGE_RE` to module scope. Hot path: `validateObjectKey` runs 4×
  per multipart upload, plus every catalog/object request.
- `docs(claude)`: new `docs/CLAUDE_PRACTICES.md` (handoff convention +
  Claude workflow conventions for the repo), pointers added in
  `CLAUDE.md` + `docs/DOCS_INDEX.md`.

### Operational fixes made along the way

| Action | Why |
|---|---|
| `gh secret set R2_APP_USERNAME --body v1editor` | `emit-auth-hashes.cjs` and `desktop.yml` now hard-require it |
| `gh secret set CLOUDFLARE_API_TOKEN` (new token) | Previous token lacked Workers Scripts:Edit scope — was the original root cause of "Authentication error" |
| `gh workflow run worker-deploy.yml` | Pushed the new Worker code live |
| Local verify: `/v1/objects` → 200, `/v1/r2/temporary-credentials` → 404 | Confirmed new routes live + deleted route gone |
| Desktop relaunch → `Catalog 147d6bc7: loaded 212/212 entries` | End-to-end sync confirmed working |

## What's still open (small, follow-ups)

1. **v0.3.6 CI in flight** — `Desktop` and `CI` runs for the v0.3.6
   tag are in progress at the moment of archive; Worker deploy already
   succeeded. Should go green now both GH secrets are correct.
2. **Pulumi state cleanup** (Phase 3b, deferred). Pulumi still tracks
   the Worker resource locally. After Worker is fully managed by
   wrangler, run on a host with the passphrase:
   ```bash
   cd infra/cloudflare
   PULUMI_CONFIG_PASSPHRASE='weatherv1-r2-local-dev-2026' \
     pulumi state delete \
     urn:pulumi:dev::weatherv1-cloudflare::cloudflare:index/workersScript:WorkersScript::r2-gateway
   ```
   (plus workers-dev-subdomain + workers-route if present). Risk if
   left: `pulumi up` would try to re-create the Worker → 409 Conflict.
   Not destructive, just noisy.
3. **`rotate-worker-secrets.yml`** has never been dispatched. The
   Worker still holds the secrets Pulumi originally set, which happen
   to match `EDITOR_PASSWORD` (`yallabeitar`). Run it once next time
   you change `EDITOR_PASSWORD` to canonicalize. Optional now.

## Reference

| Topic | File |
|---|---|
| Rotation runbook | [`docs/RUNBOOK_WORKER_ROTATION.md`](../../docs/RUNBOOK_WORKER_ROTATION.md) |
| Handoff format + workflow conventions | [`docs/CLAUDE_PRACTICES.md`](../../docs/CLAUDE_PRACTICES.md) |
| Plan file (full architecture rationale + research) | `/Users/barmoshe/.claude/plans/based-on-all-that-cheeky-wave.md` |
| Live Worker URL | `https://weatherv1-r2-gateway.barprojectsandbuilds.workers.dev` |
| Local desktop install | `/Applications/WeatherV1.app` (x64 build, Rosetta on Apple Silicon) |
