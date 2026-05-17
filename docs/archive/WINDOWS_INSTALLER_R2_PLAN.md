# Archived: Plan — Host Windows installer in R2, drop macOS from CI

> **Shipped.** See [`WINDOWS_INSTALLER_R2_TASK.md`](./WINDOWS_INSTALLER_R2_TASK.md)
> for the shipped-state pointers. This file is the implementation plan
> kept for historical rationale.

**Task brief:** [`WINDOWS_INSTALLER_R2_TASK.md`](./WINDOWS_INSTALLER_R2_TASK.md).

## Files to change

| File | Change |
| --- | --- |
| `infra/cloudflare/worker/r2-gateway.js` | New public `GET`/`HEAD` `/downloads/*` route; existing routes unchanged. |
| `infra/cloudflare/index.ts` | No edit needed (`contentSha256` redeploys on next `pulumi up`). |
| `infra/cloudflare/README.md` | Document the new public route + its key prefix. |
| `.github/workflows/desktop.yml` | No change. |
| `.github/workflows/desktop-publish-release.yml` | Delete `action-gh-release` step; add two `wrangler r2 object put` calls + a `TODO(latest-stable)` comment; drop `contents: write` permission. |
| `.github/workflows/pitch-deck.yml` | Extend the `sed` block to substitute `__WIN_INSTALLER_URL__` from `${{ vars.WIN_INSTALLER_URL }}` with a hard-coded fallback. |
| `docs/download-page/index.html.template` | Replace GitHub Releases URL with `__WIN_INSTALLER_URL__` token (lines ~5489 and ~5666); insert Hebrew Mac contact note; add matching small CSS rule. |
| `docs/RELEASE_CONVENTION.md` | New "Building the macOS installer locally" section; update asset names + verification URLs to the Worker route. |
| `.claude/skills/weatherv1-release/SKILL.md` | Verification step curls Worker URL instead of GitHub Releases. |
| `docs/future/README.md` | Register `WINDOWS_INSTALLER_R2_TASK.md` and this file. |

## Step 1 — Worker route

Edit `infra/cloudflare/worker/r2-gateway.js`. Insert this block **before**
the `checkBasicAuth(request, env)` call (around line 73, after the
`/v1/health` handler) so it remains unauthenticated.

```js
// Public installer downloads. Served unauthenticated from R2 under the
// `downloads/` key prefix. Strict path whitelist prevents traversal; temp
// creds minted by /v1/r2/temporary-credentials scope to `tenants/...` only,
// so they can never read or overwrite anything under `downloads/`.
if (
  (request.method === "GET" || request.method === "HEAD") &&
  url.pathname.startsWith("/downloads/")
) {
  const rawKey = decodeURIComponent(url.pathname.slice("/".length));
  if (
    rawKey.length > 256 ||
    rawKey.includes("..") ||
    rawKey.includes("//") ||
    !/^[A-Za-z0-9._/-]+$/.test(rawKey)
  ) {
    return json({ success: false, error: "bad request" }, cors, 400);
  }

  const range = request.headers.get("range") || undefined;
  const object =
    request.method === "HEAD"
      ? await env.WEATHERV1_MEDIA.head(rawKey)
      : await env.WEATHERV1_MEDIA.get(rawKey, range ? { range } : undefined);
  if (!object) return json({ success: false, error: "not found" }, cors, 404);

  const filename = rawKey.split("/").pop() || "download.bin";
  const isMutablePointer =
    rawKey.includes("/latest/") || rawKey.includes("/latest-stable/");
  const headers = {
    ...cors,
    "content-type": "application/octet-stream",
    "content-disposition": `attachment; filename="${filename}"`,
    etag: object.httpEtag,
    "accept-ranges": "bytes",
    "cache-control": isMutablePointer
      ? "public, max-age=300"
      : "public, max-age=31536000, immutable",
  };
  if (object.size !== undefined) headers["content-length"] = String(object.size);
  if (object.uploaded) headers["last-modified"] = new Date(object.uploaded).toUTCString();

  if (request.method === "HEAD") {
    return new Response(null, { status: 200, headers });
  }
  const status = range && object.range ? 206 : 200;
  if (status === 206 && object.range) {
    const start = object.range.offset ?? 0;
    const length = object.range.length ?? 0;
    const end = start + length - 1;
    headers["content-range"] = `bytes ${start}-${end}/${object.size}`;
  }
  return new Response(object.body, { status, headers });
}
```

After `pulumi -C infra/cloudflare up`, the Worker redeploys because
`contentSha256` recomputes from the new file content
(`infra/cloudflare/index.ts:29`). No Pulumi schema change.

## Step 2 — Release workflow

Edit `.github/workflows/desktop-publish-release.yml`.

1. **Reduce permissions** (delete `contents: write`, keep `actions: read`):
   ```yaml
   permissions:
     actions: read
   ```

2. **Delete** the `softprops/action-gh-release@v2` step (lines 102-111
   today).

3. **Append** the R2 upload step:
   ```yaml
   - name: Upload installer to R2
     env:
       TAG: ${{ steps.reltag.outputs.tag }}
       R2_BUCKET: weatherv1-media
     # TODO(latest-stable): once we adopt a stable-vs-prerelease tag convention
     # (e.g. SemVer prerelease suffix: vX.Y.Z stable, vX.Y.Z-beta.N prerelease),
     # gate a third `wrangler r2 object put` to
     # downloads/windows/latest-stable/WeatherV1-Setup.exe on the stable check.
     uses: cloudflare/wrangler-action@v3
     with:
       apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
       accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
       command: |
         r2 object put \
           ${R2_BUCKET}/downloads/windows/${TAG}/WeatherV1-Setup.exe \
           --file=dist/WeatherV1-Setup.exe \
           --content-type=application/octet-stream
         r2 object put \
           ${R2_BUCKET}/downloads/windows/latest/WeatherV1-Setup.exe \
           --file=dist/WeatherV1-Setup.exe \
           --content-type=application/octet-stream
   ```

   Bucket name `weatherv1-media` matches the Pulumi default
   (`infra/cloudflare/index.ts:9`). If the prod stack uses a different
   bucket name, plumb it via a repo variable.

Secrets `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` already exist
(used by `.github/workflows/pitch-deck.yml:45-46`). No new secrets.

## Step 3 — Download page + pitch-deck workflow

`docs/download-page/index.html.template`:

- **Line ~5489** — change the anchor `href`:
  ```html
  <a class="download-landing__download" href="__WIN_INSTALLER_URL__" download>
  ```
- **Line ~5666** — same replacement inside the `downloadLinks` array:
  ```js
  href: "__WIN_INSTALLER_URL__",
  ```
- **New element** — insert this `<p>` directly below the
  `.download-landing__actions` div (or as the last child inside it):
  ```html
  <p class="download-landing__mac-note">למשתמשי Mac — צרו איתי קשר ישירות לבניית גרסה.</p>
  ```
- **CSS** — add a single short rule to the existing inline `<style>`
  block; do not create a new file:
  ```css
  .download-landing__mac-note {
    margin: 0.5rem 0 0;
    color: rgba(255, 255, 255, 0.72);
    font-size: 0.9rem;
    text-align: center;
  }
  ```

`.github/workflows/pitch-deck.yml` (replace the `sed` invocation at
lines 32-33):

```yaml
- name: Render pitch deck
  env:
    WIN_INSTALLER_URL: ${{ vars.WIN_INSTALLER_URL }}
  run: |
    set -euo pipefail
    mkdir -p _site/public _site/download-page/assets
    : "${WIN_INSTALLER_URL:=https://weatherv1-r2-gateway.<account>.workers.dev/downloads/windows/latest/WeatherV1-Setup.exe}"
    sed \
      -e "s|__REPO__|${{ github.repository }}|g" \
      -e "s|__WIN_INSTALLER_URL__|${WIN_INSTALLER_URL}|g" \
      docs/download-page/index.html.template > _site/index.html
    cp public/weather-v1-icon-512.png _site/public/weather-v1-icon-512.png
    if compgen -G "docs/download-page/assets/*" > /dev/null; then
      cp -R docs/download-page/assets/. _site/download-page/assets/
    fi
```

Set `WIN_INSTALLER_URL` as a **repository variable** (Settings → Secrets
and variables → Actions → Variables) with the actual Worker hostname
once the Worker is deployed. The fallback in the script keeps the build
green if the variable hasn't been set yet but produces a non-functional
URL — so set the variable before the first post-change pitch-deck deploy.

## Step 4 — Docs

`docs/RELEASE_CONVENTION.md`:

- Replace the "expected assets" / "stable URLs" section so it reflects:
  - **Only** `WeatherV1-Setup.exe`, hosted at
    `https://<worker-host>/downloads/windows/latest/WeatherV1-Setup.exe`
    and `…/downloads/windows/<tag>/WeatherV1-Setup.exe`.
  - No macOS asset attached to GitHub Releases.
- New subsection (after the release verification steps):
  ```markdown
  ## Building the macOS installer locally

  CI does not build macOS. To produce a notarized
  `WeatherV1-<ver>.zip` on a Mac:

  1. Install Xcode Command Line Tools.
  2. Export the signing/notarization env vars:
     `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`,
     `OSX_SIGN_IDENTITY`. Without these, `electron-forge make` still
     produces an *unsigned* zip but Gatekeeper will block it.
  3. `npm run electron:make`.
  4. Artifact: `out/make/zip/darwin/x64/WeatherV1-<ver>.zip`.

  This zip is for ad-hoc distribution. There is no automation that
  uploads it to R2.
  ```

`.claude/skills/weatherv1-release/SKILL.md`:

- Replace the curl-of-stable-URL verification step with:
  ```
  curl -I https://<worker-host>/downloads/windows/latest/WeatherV1-Setup.exe
  # expect: 200, content-type: application/octet-stream,
  #         content-disposition: attachment; filename="WeatherV1-Setup.exe"
  ```
- Note that no macOS asset is expected; refer the reader to
  `docs/RELEASE_CONVENTION.md` for the local Mac build path.

`infra/cloudflare/README.md`:

- Add a short paragraph under the Worker description:
  > **Public `/downloads/*` route.** Unauthenticated `GET`/`HEAD`,
  > serves R2 objects under the `downloads/` key prefix with strict
  > path whitelisting. Used today by the public download page for
  > `downloads/windows/latest/WeatherV1-Setup.exe`. Mutable `latest/`
  > pointers get a 5-minute cache; versioned (`v<semver>/`) keys are
  > immutable, 1-year cache.

## Verification

Read-only sanity (run first):

```bash
npx tsc --noEmit
npm test
```

Worker (after `pulumi up`):

```bash
# Seed a dummy object so the new route has something to serve.
wrangler r2 object put weatherv1-media/downloads/windows/latest/WeatherV1-Setup.exe \
  --file /tmp/test.bin --content-type application/octet-stream

# Public route returns 200 with right headers.
curl -I "https://<worker-host>/downloads/windows/latest/WeatherV1-Setup.exe"

# Range request returns 206.
curl -sS -r 0-1023 -o /dev/null -w '%{http_code}\n' \
  "https://<worker-host>/downloads/windows/latest/WeatherV1-Setup.exe"

# Existing private routes still require auth.
curl -I "https://<worker-host>/v1/catalog"   # expect 401

# Path traversal blocked.
curl -I "https://<worker-host>/downloads/../tenants/default/catalog/catalog.json"  # expect 400 or 404

# Clean up the dummy object.
wrangler r2 object delete \
  weatherv1-media/downloads/windows/latest/WeatherV1-Setup.exe
```

CI dry run:

1. Cut a throwaway tag on a side branch (`git tag v0.0.0-test1 && git push origin v0.0.0-test1`).
2. Watch `Desktop` then `Desktop publish release` complete.
3. `wrangler r2 object list weatherv1-media --prefix downloads/windows/`
   → expect `downloads/windows/v0.0.0-test1/WeatherV1-Setup.exe` and
   `downloads/windows/latest/WeatherV1-Setup.exe`.
4. `gh release view v0.0.0-test1 --json assets` → expect **no** `.exe`
   asset attached.
5. Clean up: `git push --delete origin v0.0.0-test1`, `gh release delete
   v0.0.0-test1 --yes --cleanup-tag`,
   `wrangler r2 object delete weatherv1-media/downloads/windows/v0.0.0-test1/WeatherV1-Setup.exe`.

Download page:

1. After the pitch-deck workflow next runs on `main`, load
   `https://weatherv1-download.pages.dev`.
2. View source: the Windows anchor `href` is the Worker URL (no
   `__WIN_INSTALLER_URL__` token leaking through).
3. Click the button → installer downloads.
4. Hebrew Mac note renders in place of the old Mac button.

Local Mac build (manual, on a Mac host):

```bash
npm run electron:make
ls out/make/zip/darwin/x64/   # expect WeatherV1-<ver>.zip
```

Unzip and launch — confirm the desktop session-token gate still
enforces auth on `/api/*` (the existing safety rule from `CLAUDE.md`).
