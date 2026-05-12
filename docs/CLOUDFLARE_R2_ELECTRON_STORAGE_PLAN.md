# Cloudflare R2 storage plan for WeatherV1 Electron

## Goal

WeatherV1 is an Electron standalone Next.js app. The app should keep rendering and active work local, but use Cloudflare as the remote storage layer for:

- `catalog/catalog.json`
- source videos
- voiceovers
- rendered outputs
- posters/previews if useful

This is **not** a plan to deploy the app to Oracle, Vercel, or any hosted server. The app remains local-first.

---

## Target architecture

```txt
WeatherV1 Electron app
  └─ local Next.js backend
       ├─ reads/writes local workspace
       ├─ renders with local ffmpeg
       └─ syncs media with Cloudflare

Cloudflare
  ├─ R2 bucket: media object storage
  ├─ Worker: auth + access gateway
  ├─ Temporary R2 credentials or presigned URLs
  └─ optional KV/D1: license/user/session metadata
```

The Electron app must **never ship permanent R2 credentials**.

---

## Bucket layout

Use one R2 bucket first:

```txt
weatherv1-media/
└── tenants/
    └── <tenant-id>/
        ├── catalog/
        │   └── catalog.json
        ├── videos/
        │   ├── vid_001_example.mp4
        │   └── ...
        ├── voiceovers/
        │   ├── <job-id>.mp3
        │   └── ...
        ├── outputs/
        │   ├── forecast_<job-id>.mp4
        │   └── ...
        └── posters/
            ├── vid_001.jpg
            └── ...
```

Use tenant prefixes even if the first version has only one customer. It avoids redesign later.

---

## Local-first rule

The app should continue using the existing local workspace:

```txt
v1Drive/weather/
├── notouch!/catalog.json
├── videos/
└── music/

runtime/
├── uploads/
├── outputs/
└── cache/
```

R2 is the remote sync/source-of-truth layer, but ffmpeg should work from local files.

Do not make ffmpeg depend on remote URLs in v1. Download/cache source media locally first.

---

## Security model

### Do not do this

```txt
Electron app contains:
- R2_ACCESS_KEY_ID
- R2_SECRET_ACCESS_KEY
- global bucket token
```

Anything bundled in Electron should be treated as extractable.

### Recommended model

```txt
1. User opens Electron app
2. App authenticates with Cloudflare Worker using license/user token
3. Worker verifies tenant/user permissions
4. Worker returns short-lived temporary R2 credentials scoped to tenant prefix
5. Electron syncs files directly with R2
6. Credentials expire and must be refreshed
```

The Worker owns the real Cloudflare/R2 authority. The desktop app only receives temporary, scoped access.

### Access scope

Each user/install should only access:

```txt
tenants/<tenant-id>/*
```

Never grant access to the whole bucket unless it is an internal-only prototype.

### Credential lifetime

Recommended defaults:

```txt
Temporary credentials TTL: 15-60 minutes
Presigned single-object URLs: 5-15 minutes
Local app session/license token: longer-lived, stored securely by Electron
```

Use Electron `safeStorage` or OS keychain-style storage for the app session/license token. Do not use it to store global R2 secrets.

---

## Access strategy

### Option A — temporary R2 credentials

Best for real sync.

Use this when the app needs to upload/download many files:

```txt
videos/*
voiceovers/*
outputs/*
catalog/catalog.json
```

Pros:

- efficient for many files
- direct Electron-to-R2 transfer
- Worker does not proxy large video files
- can be scoped and short-lived

Cons:

- requires implementing credential refresh
- must carefully scope access

### Option B — presigned URLs

Best for one-off operations.

Use this when the app needs exactly one operation:

```txt
PUT one voiceover
GET one video
PUT one rendered output
DELETE one object
```

Pros:

- simple mental model
- one URL = one operation
- low blast radius

Cons:

- annoying for bulk sync
- Worker must generate many URLs

### Recommendation

Use temporary credentials for the sync engine. Keep presigned URLs as a later fallback for share/download links.

---

## Data ownership rules

| Asset | Local behavior | R2 behavior | Access |
| --- | --- | --- | --- |
| Catalog JSON | edited locally | synced to `catalog/catalog.json` | private |
| Source videos | cached locally for ffmpeg | stored in `videos/` | private |
| Voiceovers | stored in `runtime/uploads` | stored in `voiceovers/` | private |
| Rendered outputs | stored in `runtime/outputs` | stored in `outputs/` | private by default, shareable later |
| Posters/previews | stored in cache | optional `posters/` | can be public later |

---

## Conflict handling

The catalog is the highest-risk file because it is mutable.

Use simple version metadata in v1:

```json
{
  "version": "2026-05-13T12:00:00.000Z",
  "updated_at": "2026-05-13T12:00:00.000Z",
  "videos": []
}
```

Before pushing local catalog to R2:

1. fetch remote metadata/version
2. compare with last synced version
3. if remote changed, block overwrite and ask user to pull/merge
4. if no conflict, upload local catalog

Avoid silent last-write-wins for catalog edits.

For videos/voiceovers/outputs, use immutable filenames and avoid overwrites.

---

## Caching rules

### Catalog

Do not cache aggressively.

```txt
Cache-Control: no-cache
```

or short TTL:

```txt
Cache-Control: max-age=30
```

### Videos / voiceovers / outputs

Use immutable object keys where possible.

```txt
Cache-Control: public, max-age=31536000, immutable
```

This only works if files are never overwritten in place.

---

## Repo integration plan

### New storage abstraction

Add:

```txt
src/server/storage/media-store.ts
```

Suggested interface:

```ts
export interface MediaStore {
  readCatalog(): Promise<string>;
  writeCatalog(raw: string): Promise<void>;
  uploadVideo(localPath: string, key: string): Promise<void>;
  downloadVideo(key: string, localPath: string): Promise<void>;
  uploadVoiceover(localPath: string, key: string): Promise<void>;
  uploadOutput(localPath: string, key: string): Promise<void>;
  objectExists(key: string): Promise<boolean>;
}
```

Implementations:

```txt
LocalMediaStore
R2MediaStore
```

### Cloudflare auth client

Add:

```txt
src/server/cloudflare/auth-client.ts
```

Responsibilities:

- call Worker with app session/license token
- receive temporary credentials
- refresh before expiry
- expose R2/S3-compatible client config to `R2MediaStore`

### Sync service

Add:

```txt
src/server/sync/media-sync.ts
```

Responsibilities:

- push catalog
- pull catalog
- upload missing videos
- download missing videos
- upload voiceovers after transcription
- upload rendered outputs after render
- report progress to UI

---

## Existing repo touch points

### Catalog video import

Current flow copies video to local videos dir, probes it, writes catalog, and generates poster.

Keep that flow. After successful local import:

```txt
upload video to R2
upload updated catalog to R2
optional upload poster to R2
```

Likely touch point:

```txt
src/app/api/catalog/videos/route.ts
```

### Voiceover import/transcription

Current flow writes audio into `runtime/uploads`, transcribes, then creates a job.

After successful save/transcribe:

```txt
upload voiceover to R2
store remote key in plan/job metadata if needed
```

Likely touch point:

```txt
src/app/api/transcribe/route.ts
```

### Render output

Current worker renders to local `runtime/outputs/forecast_<jobId>.mp4`.

After render success:

```txt
upload output MP4 to R2
save remote output key/url on the job
keep local fallback
```

Likely touch point:

```txt
src/server/jobs/worker.ts
```

---

## Cloudflare Worker plan

Create a separate Worker project, not inside the Electron bundle.

Endpoints:

```txt
POST /auth/session
POST /r2/temporary-credentials
POST /r2/presign
GET  /health
```

Minimal v1 auth:

```txt
Electron sends license token
Worker maps token → tenant id
Worker returns temporary credentials scoped to tenants/<tenant-id>/*
```

Later auth options:

- email magic link
- Clerk/Auth0/Supabase auth
- Cloudflare Access
- license file / activation key

Keep v1 simple.

---

## Environment variables

Electron app / local Next backend:

```txt
WEATHERV1_CLOUDFLARE_WORKER_URL=
WEATHERV1_TENANT_ID=
WEATHERV1_STORAGE_MODE=local|r2|hybrid
```

Do not put permanent R2 secrets here for production.

Cloudflare Worker secrets:

```txt
R2_ACCOUNT_ID=
R2_BUCKET_NAME=
R2_PARENT_ACCESS_KEY_ID=
R2_PARENT_SECRET_ACCESS_KEY=
LICENSE_SIGNING_SECRET=
```

The Worker can also use R2 bindings where possible.

---

## MVP phases

### Phase 1 — manual/internal prototype

Goal: prove R2 storage works with the current local app.

- create R2 bucket
- create tenant prefix
- create local-only upload script or service
- upload catalog/videos/voiceovers/outputs manually from app code
- no full auth system yet
- use one internal tenant

Success:

```txt
A rendered output is uploaded to R2 after local render.
```

### Phase 2 — Worker-gated credentials

Goal: remove permanent R2 credentials from the Electron app.

- create Cloudflare Worker
- add license/session check
- return temporary credentials scoped to tenant prefix
- Electron stores only app token/session
- app refreshes temporary credentials automatically

Success:

```txt
Electron can upload/download files without bundled R2 secrets.
```

### Phase 3 — catalog sync

Goal: make catalog portable across installs.

- pull remote catalog
- push local catalog
- detect remote changes
- block unsafe overwrite
- show sync status in UI

Success:

```txt
A fresh install can pull catalog + download needed videos.
```

### Phase 4 — full media sync

Goal: R2 becomes the durable media library.

- upload source videos after import
- download missing videos on demand
- upload voiceovers
- upload outputs
- optional upload posters/previews
- add progress and retry UI

Success:

```txt
A new machine can recreate the working library from R2.
```

### Phase 5 — shareable outputs

Goal: allow sharing rendered forecast videos.

- generate public or signed output links
- optionally use custom domain
- keep raw source videos and voiceovers private

Success:

```txt
User can copy a safe link to a rendered MP4 output.
```

---

## Free-tier expectation

Cloudflare should be enough for a small POC:

- R2 free storage is suitable for a small media library
- Workers free tier should be enough for auth/credential requests
- video storage size is the main future cost driver

Design for cheap growth by keeping big transfers direct between Electron and R2, not proxied through the Worker.

---

## Open questions

- Is this a single shared internal media library, or one library per customer?
- Should videos be editable/deletable by every install, or only by admin users?
- Should rendered outputs be private by default or shareable by default?
- Does the app need offline mode with delayed sync?
- Should catalog conflicts be manually resolved or automatically merged?

---

## Recommended first implementation slice

Start with the smallest useful slice:

```txt
After local render completes:
1. ask Worker for temporary R2 credentials
2. upload runtime/outputs/forecast_<jobId>.mp4 to R2
3. save remote output key/url in the job record
4. keep the local output as fallback
```

This proves the security model and R2 integration without touching catalog import, source videos, or ffmpeg rendering.
