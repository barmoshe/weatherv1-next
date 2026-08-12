# HANDOFF 2026-08-12 — Cloudflare detach phase 1, fully local

**Owner:** Bar. **Plan file:** `~/.claude/plans/lets-plan-to-do-agile-milner.md`
(session-local; the durable summary is this file + the v0.5.0 release notes).
Shipped as **v0.5.0** (main + tag + GitHub release, on Bar's instruction).

## What this was

Keshet's storage path is: (1) pull everything off Cloudflare and make the app
fully local → (2) new interface against Keshet's AWS bucket → (3) re-upload.
This executed phase 1. It is a **restoration**: the app worked from a local
folder before R2; the detach removed the couplings that made the cloud path
load-bearing. R2 sync code stays in the tree as a dormant opt-in; the bucket
is untouched and is the rollback until phase 3.

## Scope decisions (Bar, 2026-08-12)

1. Data verified/pulled first, then code detach.
2. Installer distribution + download page **stay on Cloudflare** (untouched).
3. Sync code dormant, not deleted. 4. Catalog `remote` fields stay as inert
history. 5. Bucket never deleted/emptied. 6. OpenAI/Anthropic stay cloud.

## What we did (commit hashes, all on main, tag v0.5.0)

- `d68ff14` feat(scripts): **r2-local-audit** — derives every expected key from
  the remote catalog/jobs (Worker has no LIST), size-compares vs local disk
  (multipart etags are not MD5s), `--download` fetches only the delta,
  `--probe` ffprobes. Run result: **841 objects ok ≈12.4 GiB; 2 voiceover mp3s
  pulled; catalog differs only by a 6-byte rounding artifact (row IB140)**.
  Manifest: `runtime/archive/r2-audit-2026-08-12/`. No bucket listing was
  available (needs an S3 token or wrangler login), so orphan keys were not
  enumerated — harmless while the bucket is retained.
- `21905ee` fix(catalog): restore catalog tab vertical scroll (regression from
  the 874d904 root viewport lock; panel is now its own scroll container).
- `576bace` feat(render): local-first sources — on-disk clips cut in place; R2
  download only for cloud-only clips when sync is configured; clean error
  otherwise. This was the single hardest cloud dependency.
- `a2db4f4` fix(export): clean "not available locally" error when sync is off.
- `41616b8` fix(catalog): `cloud_only` availability derived only while sync is
  enabled; otherwise a missing file reads as a local problem.
- `b3a8308` feat(posters): local regeneration before any R2 fallback;
  `force=1` stays the cache-buster.
- `c33a47d` fix(boot): **no more R2 pull at startup or on GET /api/jobs** —
  the pull replaced local `runtime/jobs.json` with the stale 2026-05-13 remote
  snapshot on every boot (observed live: 3 May-17 jobs dropped). Local
  jobs.json is truth; manual pulls remain on `/api/sync/r2/*`.
- `7ae85e9` refactor(auth): `EDITOR_USERNAME` primary, `R2_APP_USERNAME`
  accepted fallback (CI secrets unchanged); generated module keeps a
  same-value legacy export for one release.
- `dcc49b3` feat(desktop): packaged builds **default to local storage**; sync
  follows stored settings (default off); `PRODUCTION_R2` supplies fallback
  values only; the enable checkbox now renders in packaged builds.
- `52b4249` feat(onboarding): **local-library setup wizard** — in local mode,
  a workspace that is not a real library (no catalog, or catalog with no files
  on disk) gets a wizard to pick the permanent local drive
  (`~/weatherV1/v1Drive/weather`); names Keshet AWS sync as the future phase.
  `desktop/status` gained `localCache.presentCount` (rows with the video file
  on disk) to tell an empty cache from a real library.
- `d2a5ce5` chore(release): v0.5.0 (minor bump: storage-model feature release).

## Current state

- Tests 346/346 (59 files), `tsc` clean, `next build` clean,
  `electron-forge package` succeeds.
- Relaunched `electron:dev` on v0.5.0 with `r2.enabled=false`: worker starts
  instantly, no sync traffic, `runtime/jobs.json` untouched — B5 verified live.
- Bar's Electron settings (`~/Library/Application Support/weatherv1-next/
  settings.json`): `r2.enabled` set to `false` this session; `workspaceDir`
  still points at the empty `local-cache`, so the wizard fires on launch.
- CI (Desktop + publish to R2) was in progress at handoff time for tag v0.5.0.

## Next steps

**Immediately**
1. Bar walks the wizard: pick `/Users/barmoshe/weatherV1/v1Drive/weather` →
   app restarts → catalog should show 212/212 local; then render a job
   end-to-end and confirm posters show `X-Poster-Source: ffmpeg-local`.
2. Watch CI for the tag: `gh run list --limit 5` in this repo; then verify the
   installer URLs per `docs/RELEASE_CONVENTION.md`.

**Then**
3. Decide `runtime/jobs.json`: restore/merge from
   `runtime/jobs.json.bak-2026-08-12` (3 local May-17 jobs) vs keep the pulled
   state (4 jobs incl. the May-25 remote one). Boot no longer overwrites.
4. Optional completeness: mint a read-only S3 token (or `wrangler login`) and
   re-run the audit with `--listing` to enumerate orphan keys.
5. Phase 2 blockers live in `bar_builds/clients/v1keshet-client/STATUS.md`
   (bucket auth model; which AWS service/account/region).

## Key files

| File | Why |
| --- | --- |
| `scripts/r2-local-audit.ts` | audit/pull tool (usage in header) |
| `src/server/jobs/render-media.ts` | local-first source resolution |
| `src/client/components/storage/StorageOnboardingGate.tsx` | wizard (`local-setup` phase) |
| `electron/config.cjs` | sync default now settings-driven |
| `scripts/emit-auth-hashes.cjs` | EDITOR_USERNAME primary |
| `runtime/jobs.json.bak-2026-08-12` | pre-overwrite job history (gitignored) |

## Tests and checks status

`npx tsc --noEmit` ✓ · `npm test` 346/346 ✓ · `npm run build` ✓ ·
`npm run standalone:prep && electron-forge package` ✓ · audit re-run: zero
remote-only under `tenants/default/` (catalog rounding diff only).

## Important context the user said

- "Before connecting Cloudflare we already worked with the local folder" — the
  v1Drive tree is the original, intact source of truth.
- The wizard should present v1Drive as the **permanent phase** and Keshet AWS
  as the future phase. Push to main + tag + release were explicit instructions.

## Don't do

- Don't delete or empty the R2 bucket before phase 3 (it is the rollback).
- Don't verify media by ETag (multipart etags); size + ffprobe only.
- Don't re-enable boot pulls of jobs.json; local is truth now.
- Don't touch `.github/workflows/*` or `infra/cloudflare/**` for phase 1
  reasons; installer distribution intentionally stays on Cloudflare.
- Don't quote `docs/CLOUDFLARE_INTEGRATION.md` / `docs/R2_PULUMI_HANDOFF.md`
  as current (both partly stale; see the 2026-08-10 research handoff in
  `bar_builds/clients/v1keshet-client/`).
