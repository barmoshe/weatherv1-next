# Handoff: extract `weatherV1-next` into its own repo

Step-by-step instructions for splitting the Next.js port at `weatherV1-next/` out of this monorepo into a standalone repository. After extraction the new repo can have its own CI, releases, contributors, and issue tracker; the parent repo keeps the Flask app and the canonical media tree.

The companion docs are `DEPLOY_ORACLE_CLOUD.md` (where the new repo will live in production) and `DESIGN_DEPLOYMENT.md` (architecture rationale).

## Goal

- A new GitHub repo containing only the Next.js port (`weatherV1-next/` contents promoted to the repo root).
- Git history preserved for files inside `weatherV1-next/` only — commits that only touched the Flask app are dropped from the new history.
- The two cross-repo path references in the code are resolved before the cutover.
- The parent repo (`barmoshe/weatherv1`) loses `weatherV1-next/` and continues hosting the Flask app + canonical `v1Drive/` media tree.

## 1. Cross-repo dependencies to resolve before splitting

Two files in `weatherV1-next/src/` reach **above** the Next.js directory using `process.cwd()/../…`. They work today because `weatherV1-next/` is a sibling of `app/` and `v1Drive/` in this monorepo. After extraction those siblings disappear and the paths break.

| File | Line | Current resolution | What to do |
|---|---|---|---|
| `src/server/catalog/storage.ts` | 11-25 | `process.cwd()/../v1Drive/weather/{notouch!,videos}` | Keep, but document that the deploy must place a `v1Drive/` *sibling* next to the cloned repo (this is what the Oracle deploy already does at `/opt/weatherV1/v1Drive/`). Optionally add a `CATALOG_DIR` / `VIDEOS_DIR` env override so the path is configurable. |
| `src/server/ffmpeg/renderer.ts` | 89 | `process.cwd()/../app/music/…` | The Flask `app/` tree won't exist in the new repo. Change the fallback to `process.cwd()/../v1Drive/weather/music/…` (which already exists in the canonical media tree) **before** extraction. Optionally also accept a `BG_MUSIC_PATH` env override. |

Do these as **one final commit on the monorepo** before extraction. Once extracted, retrofitting them onto the new history is messier.

Suggested change in `renderer.ts:89`:

```ts
const bgMusicPath =
  opts.bgMusicPath ??
  process.env.BG_MUSIC_PATH ??
  path.join(process.cwd(), "..", "v1Drive", "weather", "music", "מוזיקת אנדר לתחזית.mp3");
```

(Same name as today; the file already exists in `v1Drive/weather/music/` per the canonical layout.)

## 2. Tag the extraction point in the monorepo

Before rewriting any history, plant a tag so the pre-split state is recoverable:

```bash
cd /home/user/weatherV1
git tag pre-extract-weatherV1-next
git push origin pre-extract-weatherV1-next
```

If anything goes wrong, the tag is the rollback anchor.

## 3. Extract the subtree

`git subtree split` is built-in, fast, and produces a new branch whose history contains only commits that touched `weatherV1-next/`, with the path prefix stripped:

```bash
cd /home/user/weatherV1
git subtree split --prefix=weatherV1-next -b weatherv1-next-extracted
```

Result: a local branch `weatherv1-next-extracted` whose root is what was `weatherV1-next/`. Verify:

```bash
git log weatherv1-next-extracted --oneline | head
git ls-tree --name-only weatherv1-next-extracted | head
# expect: AGENTS.md  CLAUDE.md  Dockerfile  README.md  docker-compose.yml  docs  ...
```

If the history has lots of file renames/moves between the monorepo's `weatherV1-next/` and other paths, `git filter-repo --subdirectory-filter weatherV1-next` is the more powerful alternative (requires `pip install git-filter-repo`).

## 4. Create the GitHub repo and push

In the GitHub UI (or `gh repo create` if available locally):

- Name: `weatherv1-next` (lowercase, matches `package.json`'s `"name"`)
- Visibility: same as the parent (`barmoshe/weatherv1` is public; mirror that)
- Do **not** initialise with README/LICENSE/gitignore — the extracted branch already has them.

Then push the extracted branch as `main`:

```bash
git remote add weatherv1-next git@github.com:<owner>/weatherv1-next.git
git push weatherv1-next weatherv1-next-extracted:main
```

Set the default branch to `main` in the GitHub repo settings if it isn't already.

## 5. Wire up the new repo basics

In a fresh clone of the new repo:

```bash
git clone git@github.com:<owner>/weatherv1-next.git
cd weatherv1-next
```

Replace the boilerplate `README.md` (it's still the create-next-app default) with a project README that includes:

- One-paragraph what-this-is
- Link to `docs/DEPLOY_ORACLE_CLOUD.md` for the production deploy
- Link to `docs/DESIGN_DEPLOYMENT.md` for the architecture
- Local dev quickstart: `npm install`, `cp .env.example .env`, `npm run dev` (note that the catalog + media tree must live at `../v1Drive/weather/` even in dev)

Copy the LICENSE from the parent repo (if it has one — check `barmoshe/weatherv1` root). If the parent is unlicensed, this is the right moment to pick one (MIT or Apache-2.0 are common defaults).

Add a `.github/workflows/ci.yml` with three jobs:

1. **Lint + typecheck** — `npm ci && npx tsc --noEmit` (and any ruff/eslint if added later)
2. **Test** — `npm test` (vitest)
3. **Docker build + push to GHCR** — on tagged releases only, builds `linux/arm64` and `linux/amd64` and pushes to `ghcr.io/<owner>/weatherv1-next:<tag>`. The Oracle VM can then `docker pull` instead of building.

Enable branch protection on `main`: require CI green, require PR review for non-trivial changes.

## 6. Update the deploy guide URL

`docs/DEPLOY_ORACLE_CLOUD.md` currently references `https://github.com/barmoshe/weatherv1.git` in the clone step. Update it to the new repo URL:

```bash
git clone https://github.com/<owner>/weatherv1-next.git /opt/weatherv1-next
```

And update the rsync target path from `/opt/weatherV1/v1Drive/` to `/opt/weatherv1-next/../v1Drive/` (one dir up from the clone), since the `process.cwd()/../v1Drive/...` resolution still expects `v1Drive/` to be a *sibling* of the clone, not a child. The simplest layout on the VM becomes:

```
/opt/weather/
  ├── weatherv1-next/   (git clone)
  └── v1Drive/          (rsynced media)
```

Update the corresponding paths in the deploy guide once.

## 7. Data plane: where does `v1Drive/` live?

Three options, in order of complexity:

| Option | Setup | Notes |
|---|---|---|
| **Sibling dir, rsync'd** (current) | Place `v1Drive/` next to the clone on every host (laptop, Oracle VM). Sync with rsync when it changes. | Zero code change. What `DEPLOY_ORACLE_CLOUD.md` already documents. Recommended for now. |
| **Sibling dir, git-lfs in a second repo** | New repo `weatherv1-data` with LFS-tracked videos. Clone alongside `weatherv1-next/`. | Versioned history. LFS bandwidth fees on GitHub if heavy. |
| **Object storage (S3/R2/B2)** | Add an S3 client in `src/server/catalog/storage.ts`, swap `fs.readFileSync` for signed-URL fetches. | Cleanest long-term, biggest refactor. Tracked in `DESIGN_DEPLOYMENT.md` follow-ups. |

For the first deploy of the new repo, stick with option (a). Migrate later if local disk becomes a bottleneck.

## 8. Cutover in the parent (monorepo)

After the new repo is live and you've confirmed a clean deploy from it (see verification checklist below), clean up the parent:

```bash
cd /home/user/weatherV1
git checkout main
git pull
git rm -r weatherV1-next/
git commit -m "Extract weatherV1-next into its own repo (<owner>/weatherv1-next)"
git push origin main
```

Optionally leave a `weatherV1-next/MIGRATED.md` tombstone instead of deleting outright — one-liner pointing at the new repo URL. The pattern is consistent with how Phase 4 archived stale docs into `archive/` rather than deleting them.

Either way, also update the root `CLAUDE.md`'s reference to `weatherV1-next/` (the "Add weatherV1-next app and remove system prompt" line at `c778aa6`) to note the repo split.

## 9. Verification checklist

Once the new repo is pushed and the deploy guide URL is updated, do an end-to-end run:

1. **Clone fresh** — `git clone git@github.com:<owner>/weatherv1-next.git` on a clean machine.
2. **Build the image** — `docker buildx build --platform linux/arm64 -t weatherv1-next:test .` succeeds.
3. **Run tests** — `npm ci && npm test` passes (vitest, the existing suite under `src/test/`).
4. **Smoke deploy on Oracle** — follow `docs/DEPLOY_ORACLE_CLOUD.md` end-to-end from a blank VM. The transcribe → plan → render pipeline produces a forecast video.
5. **Confirm git history preserved** — `git log` in the new repo shows the commits that touched `weatherV1-next/` (including the recent Dockerfile/docs commit), with their original authors and dates.
6. **Confirm parent is clean** — `weatherV1-next/` is gone (or tombstoned) in the monorepo, and the Flask app's tests / build still pass.

## 10. Risks and rollback

| Risk | Mitigation |
|---|---|
| `subtree split` drops commits or merges wrongly | The `pre-extract-weatherV1-next` tag in the monorepo lets you redo the split with `filter-repo`. Don't delete it for at least a release cycle. |
| The two `process.cwd()/../…` paths still surprise someone | Add the env-override pattern (`CATALOG_DIR`, `VIDEOS_DIR`, `BG_MUSIC_PATH`) as a small follow-up PR in the new repo. |
| Image build needs `npm ci` against private packages | Today everything is on npm public; if private deps get added later, configure `NPM_TOKEN` as a GitHub Actions secret. |
| OpenAI/Gemini keys leak via committed `.env` | The `.gitignore` excludes `.env*` except `.env.example`; verify with `git check-ignore -v .env` after extraction. |
| Two repos drift out of sync on shared modules | Right now there are no shared modules — the Flask app and the Next port are independent rewrites. Stays clean as long as that holds. |

## Appendix: what's in scope per file

After extraction the new repo's root should look like:

```
weatherv1-next/
├── .dockerignore
├── .env.example
├── .gitignore
├── AGENTS.md
├── CLAUDE.md
├── Dockerfile
├── README.md           ← rewrite during step 5
├── docker-compose.yml
├── docs/
│   ├── DEPLOY_ORACLE_CLOUD.md
│   ├── DESIGN_DEPLOYMENT.md
│   └── HANDOFF_NEW_REPO.md   (this file — keep for the record)
├── instrumentation.ts
├── next.config.ts
├── package.json
├── package-lock.json
├── public/
├── runtime/            ← keep .gitignore'd; created at runtime
├── src/
├── tsconfig.json
└── vitest.config.ts
```

Nothing else from the monorepo travels with it. The Flask `app/`, the canonical `v1Drive/` media tree, `archive/`, and `original_zips/` all stay in the parent.

## Status (as of pre-extraction pass)

The following items from this guide are **done** and committed to the monorepo:

- **Step 1 — Cross-repo path fix**: `renderer.ts:89` updated to `../v1Drive/weather/music/…` with `BG_MUSIC_PATH` env override.
- **Step 5 — README**: `README.md` rewritten (project description, dev quickstart, doc links).
- **Step 5 — CI workflow**: `.github/workflows/ci.yml` added (lint/typecheck, test, Docker multi-arch on tags).
- **Step 6 — Deploy guide URLs**: `docs/DEPLOY_ORACLE_CLOUD.md` updated to new `/opt/weather/` layout and `barmoshe/weatherv1-next` clone URL.

**Remaining** (to be done in the extraction iteration):

- Step 2: Tag `pre-extract-weatherV1-next` in the monorepo.
- Step 3: `git subtree split --prefix=weatherV1-next -b weatherv1-next-extracted`.
- Step 4: Create `barmoshe/weatherv1-next` on GitHub and push.
- Step 8: Tombstone `weatherV1-next/` in the parent monorepo.
- Step 9: Run the full verification checklist from a fresh clone.
