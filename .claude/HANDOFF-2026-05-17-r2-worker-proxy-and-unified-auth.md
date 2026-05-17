# Handoff — R2 Worker proxy migration shipped, CI blocked on 2 secrets

**Date:** 2026-05-17
**Owner:** Bar
**Plan:** [`/Users/barmoshe/.claude/plans/based-on-all-that-cheeky-wave.md`](file:///Users/barmoshe/.claude/plans/based-on-all-that-cheeky-wave.md)
**Practices for handoffs themselves:** [`docs/CLAUDE_PRACTICES.md`](../docs/CLAUDE_PRACTICES.md)

## TL;DR for whoever opens this next

The R2 sync rewrite is **code-complete and pushed** as `v0.3.5`. The
local Mac app installs and runs cleanly. R2 sync still doesn't work
because **two GitHub secrets need fixing** and the CI workflows need a
re-run. Both fixes are one command each. No code changes needed.

## ⚠️ Blocking — fix these two GH secrets first

```bash
# Secret 1: CF API token needs Workers Scripts:Edit scope.
# Mint a new token in https://dash.cloudflare.com/profile/api-tokens
# using the "Edit Cloudflare Workers" template (gives Workers Scripts:Edit
# + Account Settings:Read + User Details:Read).
gh secret set CLOUDFLARE_API_TOKEN

# Secret 2: missing entirely. emit-auth-hashes.cjs now hard-requires it,
# and desktop.yml asserts it pre-build.
gh secret set R2_APP_USERNAME --body v1editor
```

Then re-run the failed runs in one shot:

```bash
gh workflow run worker-deploy.yml
gh run rerun 25988154186 --failed   # Desktop v0.3.5 (Windows installer)
gh run rerun 25988154170 --failed   # CI v0.3.5 (docker build)
gh workflow run rotate-worker-secrets.yml   # after worker-deploy succeeds
```

Verify end-to-end:

```bash
# 200 with JSON body
curl -sS -o /dev/null -w '%{http_code}\n' \
  -u v1editor:yallabeitar \
  'https://weatherv1-r2-gateway.barprojectsandbuilds.workers.dev/v1/objects?key=tenants/default/catalog/catalog.json'

# 404 (route was deleted in this release)
curl -sS -o /dev/null -w '%{http_code}\n' \
  -u v1editor:yallabeitar \
  -X POST -H 'content-type: application/json' -d '{"tenantId":"default"}' \
  'https://weatherv1-r2-gateway.barprojectsandbuilds.workers.dev/v1/r2/temporary-credentials'
```

Then relaunch the local app:

```bash
pkill -f WeatherV1; sleep 2
rm -rf ~/Library/Application\ Support/weatherv1-next
open /Applications/WeatherV1.app
sleep 10
tail -20 ~/Library/Application\ Support/weatherv1-next/logs/next-child.log
# Expect: `Catalog … loaded N>0 entries`, no `Authentication error`,
# no `not found`.
```

## v0.3.5 push — CI results (snapshot)

| Run | Workflow | Status | Cause |
|---|---|---|---|
| `25988154159` | Worker deploy | ❌ failed | CF API token scope (fix #1 above) |
| `25988154186` | Desktop (v0.3.5) | ❌ failed | `R2_APP_USERNAME` missing (fix #2) |
| `25988154170` | CI (v0.3.5, docker) | ❌ failed | `R2_APP_USERNAME` missing |
| `25988154148` | Desktop (main) | ❌ failed | same |
| `25988154179` | CI (main) | ✅ green | (pre-refactor commit) |
| `25988201816` / `25988204533` | Desktop publish to R2 | ⏭️ skipped | gated on Desktop success |

Both Desktop publish-to-R2 runs auto-skipped — they'll fire again once
Desktop passes.

## What shipped (commits)

- `a10e24f refactor(r2,auth): proxy R2 through Worker, unify editor credential`
- `4ae2aa2 chore(release): v0.3.5`
- Tag `v0.3.5` pushed to origin alongside `main`.

Pre-existing in history but irrelevant to current work:
- `632b9af chore: temp workflow to rotate worker secrets via CF API`
  (workflow file was removed in a later commit; commit itself remains)

## What changed in the codebase

### Architecture
- **R2 client**: zero AWS SDK. All object I/O goes through the gateway
  Worker via `/v1/objects` (single PUT/GET ≤ ~90 MB) and `/v1/multipart/*`
  (chunked uploads for videos). HTTP Basic Auth with the unified editor
  credential.
- **Auth**: editor login + R2 Worker share GH secret `EDITOR_PASSWORD`
  (Argon2id hash baked into the build; plaintext bound to the Worker
  via `rotate-worker-secrets.yml`). Username from GH secret
  `R2_APP_USERNAME`, default `v1editor`.
- **Worker management**: wrangler, not Pulumi. `wrangler.toml`
  declares the script + R2 binding; `worker-deploy.yml` deploys on push
  to main when worker files change.

### Key files modified

| File | What |
|---|---|
| `infra/cloudflare/worker/r2-gateway.js` | New proxy routes (`/v1/objects`, `/v1/multipart/*`); deleted `/v1/r2/temporary-credentials` |
| `src/server/sync/r2/client.ts` | Rewritten — fetch-only, no S3 SDK |
| `src/server/sync/r2/types.ts` | Dropped `R2TemporaryCredentials` |
| `package.json` | Removed `@aws-sdk/client-s3`, `@aws-sdk/lib-storage`; `electron:build` invokes `npm run build` so the prebuild hook fires |
| `electron/config.cjs` | R2 cred fallback chain (settings → env → R2_DEFAULTS) |
| `scripts/emit-r2-defaults.cjs` (new) | Bakes `EDITOR_PASSWORD` into `electron/r2-defaults.generated.cjs` |
| `scripts/emit-auth-hashes.cjs` | Now also emits `R2_APP_USERNAME`; **hard-requires it** |
| `src/client/components/auth/EditorLoginGate.tsx` | Propagates pw to R2 via `desktop.saveSettings` |
| `src/client/components/storage/StorageOnboardingGate.tsx` | Recovery-only (no more sign-in form) |
| `src/server/runtime/auth-passwords.ts` + `.generated.d.ts` | Reads username from generated constant |
| `infra/cloudflare/wrangler.toml` (new) | Wrangler config for Worker |
| `infra/cloudflare/index.ts` | Dropped unused Worker bindings; kept R2 bucket + Pages |
| `infra/cloudflare/Pulumi.dev.yaml` | Removed `cloudflareApiToken` + `r2ParentAccessKeyId` config |
| `.github/workflows/worker-deploy.yml` (new) | wrangler deploy on push |
| `.github/workflows/rotate-worker-secrets.yml` (new) | `wrangler secret bulk` on dispatch |
| `docs/RUNBOOK_WORKER_ROTATION.md` (new) | Rotation runbook |
| `docs/CLAUDE_PRACTICES.md` (new) | Handoff convention + Claude workflow conventions for this repo |
| `docs/DOCS_INDEX.md`, `CLAUDE.md` | Pointers to runbook + practices |

## Uncommitted in working tree (not in v0.3.5)

```
?? docs/CLAUDE_PRACTICES.md
 M docs/DOCS_INDEX.md
 M CLAUDE.md
?? .claude/HANDOFF-2026-05-17-r2-worker-proxy-and-unified-auth.md
```

These are the Claude practices doc + indexes + this handoff itself. Land
them in a separate `docs(claude): handoff + practices` commit so they
don't tangle with the release diff.

## Tests + local verifications

- `npx tsc --noEmit` ✓
- `npm test` ✓ (37 files, 206 tests)
- `wrangler deploy --dry-run` ✓ locally (Node 20 with wrangler@3)
- `npm run electron:build` ✓ → `out/WeatherV1-darwin-x64/WeatherV1.app`
- Local install at `/Applications/WeatherV1.app` from the pre-tag build
  (same client code as the tagged release). Launches; correctly hits
  `/v1/objects` with Basic Auth; gets `not found` until the new Worker
  code deploys.

## Deferred — Phase 3b Pulumi state cleanup

Pulumi still tracks the Worker resource in its local state file (on
whichever laptop ran the last `pulumi up`). After Worker deploy succeeds
under wrangler:

```bash
cd infra/cloudflare
PULUMI_CONFIG_PASSPHRASE='weatherv1-r2-local-dev-2026' \
  pulumi state delete \
  urn:pulumi:dev::weatherv1-cloudflare::cloudflare:index/workersScript:WorkersScript::r2-gateway
# also workers-dev-subdomain + workers-route if present
```

Skip if Pulumi state isn't accessible locally. Risk if left: `pulumi
up` on the host with stale state would try to re-create the Worker →
409 Conflict. Not destructive, just noisy.

## Other nice-to-have follow-ups (optional)

- After the cutover settles, move R2 bucket + lifecycle from Pulumi to
  wrangler too — retires Pulumi entirely.
- Add a `Worker tests` CI job: dry-run + synthetic `/v1/objects`
  PUT/GET round-trip on PRs touching the Worker.
- `src/test/runtime-desktop.test.ts` wasn't updated; consider a test
  exercising the `R2_DEFAULTS` fallback chain in `electron/config.cjs`.

## Important context the user gave (verbatim or paraphrased)

- "Single source of truth" for credentials → `EDITOR_PASSWORD`.
- "Skip Worker-side temp creds" → done (Phase 2 proxy).
- "Drop Pulumi for the Worker, manage via wrangler + CI" → done. Bucket
  + Pages stay on Pulumi (for now).
- "All and more research and plan" → plan file + RUNBOOK; nothing else
  pending from the plan beyond the deferred Pulumi cleanup.

## Don't do (per CLAUDE.md + this session's learnings)

- **Never auto-commit.** The user authorized v0.3.5's commit/tag/push
  explicitly with "do it yourself". Future commits need an equivalent
  explicit go-ahead.
- **Never store API keys in renderer localStorage.** R2 password lives
  in the Electron main process, baked at build via
  `emit-r2-defaults.cjs`.
- **`tenants/*/outputs/`** is rejected client-side (`uploadR2File`)
  AND Worker-side (`validateObjectKey`). Don't remove either guard.
- **Don't push `--force` to main.** The Claude classifier blocks
  release-shaped commits and pushes that look unauthorized — that's
  working as intended; surface the diff and ask, don't try to work
  around it.

## Open todos in my session list at handoff time

All Phase 0–4 implementation steps are completed. The only `in_progress`
item ("End-to-end: dispatch worker-deploy + rotate-worker-secrets") is
exactly what the **⚠️ Blocking** section above unblocks. Once those four
`gh` commands run green, the todo is closed and R2 sync is live.
