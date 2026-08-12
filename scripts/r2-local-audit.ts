/**
 * One-off CLI: audit every R2 object the app's state references against the
 * local disk, and optionally download the delta. Phase-1 detach tool: proves
 * the local tree is complete before Cloudflare goes dormant. Defaults to a
 * non-destructive DRY RUN; never deletes anything, on either side.
 *
 * What it checks (expected keys derived from the REMOTE catalog.json +
 * jobs.json — the Worker gateway has no LIST endpoint):
 *   tenants/<tid>/catalog/catalog.json          — report-only, never downloaded over local
 *   tenants/<tid>/jobs/jobs.json                — report-only, never downloaded over local
 *   tenants/<tid>/videos/<id>/<name>            — vs <videosDir>/<filename>
 *   tenants/<tid>/posters/clips/<vidId>.jpg     — vs runtime/cache/posters/<vidId>.jpg
 *   tenants/<tid>/posters/segments/<segId>.jpg  — vs runtime/cache/segment_posters/<segId>.jpg
 *   tenants/<tid>/voiceovers/<jobId>/<file>     — vs runtime/uploads/<basename>
 *   tenants/<tid>/jobs/<jobId>/plan.json        — vs runtime/outputs/forecast_<jobId>.plan.json
 *
 * Verification is SIZE-ONLY by design: multipart etags ("-N" suffix) are not
 * file MD5s, so etag equality would report false mismatches on large videos.
 *
 * Usage:
 *   # Dry run (default) — HEAD-sweeps R2, writes a manifest, downloads nothing
 *   WEATHER_WORKSPACE_DIR="$HOME/v1Drive/weather" \
 *     ./node_modules/.bin/vite-node --config vitest.config.ts scripts/r2-local-audit.ts
 *
 *   # With an authoritative bucket listing (catches orphan keys):
 *   #   rclone lsjson --recursive r2:weatherv1-media > /tmp/listing.json
 *   ... scripts/r2-local-audit.ts --listing /tmp/listing.json
 *
 *   # Download the delta (remote-only objects; size-mismatches go to <path>.r2)
 *   ... scripts/r2-local-audit.ts --download
 *   ... scripts/r2-local-audit.ts --download --overwrite-mismatch   # replace local on mismatch
 *
 *   # Integrity spot-check: ffprobe N downloaded videos
 *   ... scripts/r2-local-audit.ts --download --probe 10
 *
 * Env (loaded from .env.local / .env when present):
 *   WEATHER_WORKSPACE_DIR  REQUIRED — the real media tree. Without it the dev
 *                          default would silently point at runtime/workspace.
 *   R2_SYNC_ENABLED / R2_GATEWAY_URL / R2_TENANT_ID default to production,
 *   R2_APP_USERNAME + EDITOR_PASSWORD must come from env/.env.
 */

import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { loadDotenvFiles } from "./_lib/load-env";

const repoRoot = process.cwd();
loadDotenvFiles(repoRoot);

const PROD = {
  gatewayUrl: "https://weatherv1-r2-gateway.barprojectsandbuilds.workers.dev",
  tenantId: "default",
  bucketName: "weatherv1-media",
};
process.env.R2_SYNC_ENABLED ??= "1";
process.env.R2_GATEWAY_URL ??= PROD.gatewayUrl;
process.env.R2_TENANT_ID ??= PROD.tenantId;
process.env.R2_BUCKET_NAME ??= PROD.bucketName;

import {
  clipPosterKey,
  downloadR2File,
  getR2Text,
  headR2Object,
  r2Configured,
  segmentPosterKey,
  tenantKey,
  videoRemoteKey,
} from "@/server/sync/r2/client";
import { getRuntimeConfig } from "@/server/runtime/config";
import { getRuntimePaths } from "@/server/runtime/paths";
import { mapWithConcurrency } from "@/server/runtime/concurrency";
import { posterPath } from "@/server/ffmpeg/posters";
import { planBundlePath } from "@/server/jobs/plan-bundle";

interface CatalogEntryLite {
  id?: string;
  filename?: string;
  original_filename?: string;
  segments?: { id?: string }[];
  remote?: { key?: string };
}

interface JobRecordLite {
  status?: string;
  audio_filename?: string;
}

type Kind =
  | "catalog"
  | "jobs-json"
  | "video"
  | "clip-poster"
  | "segment-poster"
  | "voiceover"
  | "plan"
  | "orphan";
type Verdict = "ok" | "size-mismatch" | "remote-only" | "local-only" | "missing-both" | "orphan-remote";

interface AuditRow {
  kind: Kind;
  key: string;
  localPath: string | null;
  remoteSize: number | null;
  localSize: number | null;
  verdict: Verdict;
  downloadedTo?: string;
}

// Posters regenerate from local video; a gap is cosmetic. These three kinds
// are the actual data.
const DATA_KINDS: Kind[] = ["video", "voiceover", "plan"];
const DOWNLOADABLE: Kind[] = ["video", "clip-poster", "segment-poster", "voiceover", "plan"];

const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith("--") && !a.includes("=")));
const DOWNLOAD = flags.has("--download");
const OVERWRITE_MISMATCH = flags.has("--overwrite-mismatch");
const listingArgIdx = argv.indexOf("--listing");
const LISTING_FILE = listingArgIdx >= 0 ? argv[listingArgIdx + 1] : null;
const probeArgIdx = argv.indexOf("--probe");
const PROBE_N = probeArgIdx >= 0 ? Number(argv[probeArgIdx + 1] ?? "0") : 0;
const CONCURRENCY = 8;

function fail(msg: string): never {
  console.error(msg);
  process.exit(2);
}

if (!process.env.WEATHER_WORKSPACE_DIR) {
  fail(
    "WEATHER_WORKSPACE_DIR is required (e.g. $HOME/v1Drive/weather).\n" +
      "Refusing to run against the implicit dev workspace — under vite-node the\n" +
      "default would resolve to runtime/workspace and everything would read as missing.",
  );
}
if (!r2Configured()) {
  fail("R2 is not configured. Need R2_APP_USERNAME + EDITOR_PASSWORD in env/.env (gateway/tenant default to production).");
}

const cfg = getRuntimeConfig();
const paths = getRuntimePaths();

if (!fs.existsSync(cfg.catalogPath)) {
  fail(`Local catalog not found at ${cfg.catalogPath} — wrong WEATHER_WORKSPACE_DIR?`);
}
{
  const localCat = JSON.parse(fs.readFileSync(cfg.catalogPath, "utf8")) as { videos?: unknown[] };
  if (!Array.isArray(localCat.videos) || localCat.videos.length === 0) {
    fail(`Local catalog at ${cfg.catalogPath} has no videos — wrong WEATHER_WORKSPACE_DIR?`);
  }
}

const STAMP = new Date().toISOString().slice(0, 10);
const AUDIT_DIR = path.join(repoRoot, "runtime", "archive", `r2-audit-${STAMP}`);
fs.mkdirSync(AUDIT_DIR, { recursive: true });

async function localSizeOf(p: string | null): Promise<number | null> {
  if (!p) return null;
  try {
    const st = await fs.promises.stat(p);
    return st.isFile() ? st.size : null;
  } catch {
    return null;
  }
}

function classify(remoteSize: number | null, localSize: number | null): Verdict {
  if (remoteSize !== null && localSize !== null) {
    return remoteSize === localSize ? "ok" : "size-mismatch";
  }
  if (remoteSize !== null) return "remote-only";
  if (localSize !== null) return "local-only";
  return "missing-both";
}

/** Accepts rclone `lsjson --recursive` output (array of {Path,Size,IsDir}) or
 * aws s3api list-objects-v2 output ({Contents:[{Key,Size}]}). */
function parseListing(file: string): Map<string, number> {
  const raw = JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
  const map = new Map<string, number>();
  const rows: { key?: string; size?: number }[] = Array.isArray(raw)
    ? (raw as { Path?: string; Size?: number; IsDir?: boolean }[])
        .filter((r) => !r.IsDir)
        .map((r) => ({ key: r.Path, size: r.Size }))
    : ((raw as { Contents?: { Key?: string; Size?: number }[] }).Contents ?? []).map((r) => ({
        key: r.Key,
        size: r.Size,
      }));
  // tenantKey("") yields the `tenants/<tid>/` prefix; this filter also
  // excludes downloads/ (installer CDN, out of scope).
  const prefix = tenantKey("");
  for (const r of rows) {
    if (!r.key) continue;
    if (!r.key.startsWith(prefix)) continue;
    map.set(r.key, r.size ?? -1);
  }
  return map;
}

async function main(): Promise<void> {
  console.log(`Mode: ${DOWNLOAD ? "AUDIT + DOWNLOAD DELTA" : "DRY RUN (audit only)"}`);
  console.log(`Tenant: ${cfg.r2.tenantId} | Gateway: ${cfg.r2.gatewayUrl}`);
  console.log(`Workspace: ${cfg.workspaceDir}`);
  console.log(`Videos dir: ${cfg.videosDir}`);
  console.log(`Audit dir: ${path.relative(repoRoot, AUDIT_DIR)}`);
  console.log(
    LISTING_FILE
      ? `Listing: ${LISTING_FILE} (authoritative — orphan detection ON)`
      : "Listing: none — HEAD-sweep of derived keys only; orphan keys on R2 are INVISIBLE to this audit.",
  );
  console.log("");

  const listing = LISTING_FILE ? parseListing(LISTING_FILE) : null;

  // --- Remote state (also archived beside the manifest for reference) ------
  const catalogKey = tenantKey("catalog/catalog.json");
  const jobsKey = tenantKey("jobs/jobs.json");
  const [{ text: remoteCatalogText }, { text: remoteJobsText }] = await Promise.all([
    getR2Text(catalogKey),
    getR2Text(jobsKey),
  ]);
  fs.writeFileSync(path.join(AUDIT_DIR, "remote-catalog.json"), remoteCatalogText);
  fs.writeFileSync(path.join(AUDIT_DIR, "remote-jobs.json"), remoteJobsText);

  // Bodies fetched here (and plan bodies below) double as size sources for
  // the sweep, since the Worker's HEAD omits content-length for JSON PUTs.
  const knownTextSizes = new Map<string, number>([
    [catalogKey, Buffer.byteLength(remoteCatalogText)],
    [jobsKey, Buffer.byteLength(remoteJobsText)],
  ]);

  const remoteCatalog = JSON.parse(remoteCatalogText) as { videos?: CatalogEntryLite[] };
  const remoteJobs = JSON.parse(remoteJobsText) as Record<string, JobRecordLite>;
  const videos = remoteCatalog.videos ?? [];
  const jobIds = Object.keys(remoteJobs);
  console.log(`Remote catalog: ${videos.length} videos | Remote jobs: ${jobIds.length}`);

  // --- Derive expected keys → local paths ----------------------------------
  const expected: { kind: Kind; key: string; localPath: string | null }[] = [
    { kind: "catalog", key: catalogKey, localPath: cfg.catalogPath },
    { kind: "jobs-json", key: jobsKey, localPath: path.join(paths.runtimeDir, "jobs.json") },
  ];

  for (const entry of videos) {
    if (!entry.id) continue;
    const key = entry.remote?.key || videoRemoteKey(entry);
    const localPath = entry.filename ? path.join(cfg.videosDir, entry.filename) : null;
    expected.push({ kind: "video", key, localPath });
    expected.push({
      kind: "clip-poster",
      key: clipPosterKey(entry.id),
      localPath: posterPath(entry.id, paths.postersDir),
    });
    for (const seg of entry.segments ?? []) {
      if (!seg.id) continue;
      expected.push({
        kind: "segment-poster",
        key: segmentPosterKey(seg.id),
        localPath: posterPath(seg.id, paths.segmentPostersDir),
      });
    }
  }

  // Voiceover filenames may need the plan body; fetch those concurrently and
  // keep the byte sizes for the sweep.
  const planKeyFor = (jobId: string) => tenantKey(`jobs/${jobId}/plan.json`);
  const audioNames = new Map<string, string | undefined>(
    jobIds.map((jobId) => [jobId, remoteJobs[jobId]?.audio_filename]),
  );
  const needsPlanBody = jobIds.filter((jobId) => !audioNames.get(jobId));
  await mapWithConcurrency(needsPlanBody, CONCURRENCY, async (jobId) => {
    try {
      const { text } = await getR2Text(planKeyFor(jobId));
      knownTextSizes.set(planKeyFor(jobId), Buffer.byteLength(text));
      audioNames.set(jobId, (JSON.parse(text) as { audio_filename?: string }).audio_filename);
    } catch {
      /* plan may not exist remotely; the plan row below will say so */
    }
  });

  for (const jobId of jobIds) {
    expected.push({ kind: "plan", key: planKeyFor(jobId), localPath: planBundlePath(jobId) });
    const audioFilename = audioNames.get(jobId);
    if (audioFilename) {
      expected.push({
        kind: "voiceover",
        key: tenantKey(`voiceovers/${jobId}/${audioFilename}`),
        localPath: path.join(paths.uploadsDir, path.basename(audioFilename)),
      });
    }
  }

  // --- Remote sizes: listing where available, HEAD otherwise ---------------
  const rows: AuditRow[] = await mapWithConcurrency(expected, CONCURRENCY, async (e) => {
    let remoteSize: number | null = null;
    if (listing?.has(e.key)) {
      remoteSize = listing.get(e.key)!;
    } else if (!listing) {
      const head = await headR2Object(e.key);
      if (head?.size !== undefined) {
        remoteSize = head.size;
      } else if (head) {
        // The Worker's HEAD omits content-length for JSON PUTs; use the body
        // already in memory, or measure the small text object via GET.
        remoteSize = knownTextSizes.get(e.key) ?? Buffer.byteLength((await getR2Text(e.key)).text);
      }
    }
    const localSize = await localSizeOf(e.localPath);
    return { kind: e.kind, key: e.key, localPath: e.localPath, remoteSize, localSize, verdict: classify(remoteSize, localSize) };
  });

  if (listing) {
    const derived = new Set(expected.map((e) => e.key));
    for (const [key, size] of listing) {
      if (!derived.has(key)) {
        rows.push({ kind: "orphan", key, localPath: null, remoteSize: size, localSize: null, verdict: "orphan-remote" });
      }
    }
  }

  // --- Report ----------------------------------------------------------------
  const byVerdict = new Map<Verdict, AuditRow[]>();
  for (const r of rows) {
    const list = byVerdict.get(r.verdict) ?? [];
    list.push(r);
    byVerdict.set(r.verdict, list);
  }
  const fmtBytes = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)}MiB` : `${n}B`);

  console.log("\n=== Summary ===");
  for (const verdict of ["ok", "size-mismatch", "remote-only", "local-only", "missing-both", "orphan-remote"] as Verdict[]) {
    const list = byVerdict.get(verdict) ?? [];
    if (list.length === 0) continue;
    const bytes = list.reduce((s, r) => s + (r.remoteSize ?? 0), 0);
    console.log(`  ${verdict.padEnd(14)} ${String(list.length).padStart(4)}  (${fmtBytes(bytes)} remote)`);
  }

  const interesting = rows.filter(
    (r) => r.verdict !== "ok" && !(r.verdict === "local-only" && !DATA_KINDS.includes(r.kind)) && !(r.verdict === "missing-both" && !DATA_KINDS.includes(r.kind)),
  );
  if (interesting.length > 0) {
    console.log("\n=== Needs attention ===");
    for (const r of interesting) {
      console.log(
        `  [${r.verdict}] ${r.kind} ${r.key}\n      local: ${r.localPath ?? "-"} (${r.localSize ?? "absent"}) remote: ${r.remoteSize ?? "absent"}`,
      );
    }
  }

  const dataLoss = rows.filter((r) => r.verdict === "missing-both" && DATA_KINDS.includes(r.kind));
  if (dataLoss.length > 0) {
    console.log(`\n!! ${dataLoss.length} data object(s) exist NOWHERE (not local, not R2). Surface before proceeding.`);
  }

  // --- Download delta ---------------------------------------------------------
  let downloaded = 0;
  if (DOWNLOAD) {
    const targets = rows.filter(
      (r) => DOWNLOADABLE.includes(r.kind) && r.localPath && (r.verdict === "remote-only" || r.verdict === "size-mismatch"),
    );
    console.log(`\nDownloading ${targets.length} object(s)…`);
    await mapWithConcurrency(targets, 4, async (r) => {
      const dest = r.verdict === "size-mismatch" && !OVERWRITE_MISMATCH ? `${r.localPath}.r2` : r.localPath!;
      await downloadR2File(r.key, dest);
      r.downloadedTo = dest;
      downloaded += 1;
      console.log(`  GET ${r.key}\n   -> ${dest}`);
    });
  }

  // --- Probe spot-check -------------------------------------------------------
  if (PROBE_N > 0) {
    const probeTargets = rows
      .filter((r) => r.kind === "video" && (r.downloadedTo || (r.verdict === "ok" && r.localPath)))
      .slice(0, PROBE_N)
      .map((r) => r.downloadedTo ?? r.localPath!);
    const { getFFprobePath } = await import("@/server/ffmpeg/binaries");
    const ffprobePath = getFFprobePath();
    const run = promisify(execFile);
    console.log(`\nProbing ${probeTargets.length} video(s) with ffprobe…`);
    const results = await mapWithConcurrency(probeTargets, 4, async (p) => {
      try {
        await run(ffprobePath, ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", p]);
        return { p, ok: true as const };
      } catch (err) {
        return { p, ok: false as const, err: err instanceof Error ? err.message : String(err) };
      }
    });
    for (const r of results) {
      console.log(r.ok ? `  ok ${r.p}` : `  FAIL ${r.p}: ${r.err}`);
    }
  }

  // --- Manifest ----------------------------------------------------------------
  const manifestPath = path.join(AUDIT_DIR, "audit-manifest.json");
  fs.writeFileSync(
    manifestPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        tenantId: cfg.r2.tenantId,
        gatewayUrl: cfg.r2.gatewayUrl,
        workspaceDir: cfg.workspaceDir,
        listingProvided: Boolean(listing),
        orphanDetection: Boolean(listing),
        counts: Object.fromEntries([...byVerdict.entries()].map(([v, l]) => [v, l.length])),
        downloaded,
        rows,
      },
      null,
      2,
    ),
  );
  console.log(`\nManifest: ${path.relative(repoRoot, manifestPath)}`);
  if (!DOWNLOAD) console.log("Dry run only. Re-run with --download to fetch remote-only / mismatched objects.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
