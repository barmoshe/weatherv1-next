/**
 * Phase 1 of the catalog-empty-segment tagging handoff
 * (see docs/CATALOG_TAGGING_HANDOFF.md).
 *
 * For every segment where `tags` is empty AND `description` is empty:
 *   1. Materialise the source clip from R2 if it is not local.
 *   2. Generate a JPEG poster at the segment midpoint via
 *      `generateSegmentPoster` (single-segment clips fall back to the clip
 *      poster — that is intentional).
 *   3. Unless --no-r2-upload, mirror the poster to
 *      `tenants/<tenant>/posters/segments/<segId>.jpg`.
 *   4. Append a row to `runtime/cache/tagging/segment-tag-queue.json` that
 *      carries enough context (poster path, clip filename, clip
 *      description, sibling tags) for the labelling step to do its job
 *      without re-reading the catalog.
 *
 * Defaults to dry-run; pass --write to do disk + R2 side effects.
 *
 * Flags:
 *   --write                Actually generate posters, upload to R2, write queue.
 *   --catalog <path>       Catalog override (default: env WEATHER_CATALOG_PATH or
 *                          ../v1Drive/weather/notouch!/catalog.json).
 *   --concurrency=N        Concurrent workers per video (default 4).
 *   --limit=N              Process at most N empty segments (debug).
 *   --video=<id>           Restrict to a single clip id.
 *   --no-r2-upload         Generate posters locally but skip the R2 upload.
 *   --no-materialize       Skip clips that are not local (don't pull from R2).
 *   --queue-out <path>     Override queue file path (default in runtime/cache).
 *   --help, -h             Show this message.
 */

import fs from "node:fs";
import path from "node:path";
import { getRuntimePaths } from "@/server/runtime/paths";
import { readCatalog, getVideosDir } from "@/server/catalog/storage";
import { parseCatalog, buildVideoMap } from "@/server/catalog/parser";
import { generateSegmentPoster } from "@/server/ffmpeg/segment-posters";
import { selectEmptySegments } from "@/server/catalog/tagging";
import { materializeVideo } from "@/server/sync/r2/service";
import { r2Configured, tenantKey, uploadR2File } from "@/server/sync/r2/client";
import type { ParsedVideo } from "@/shared/types";

interface Args {
  write: boolean;
  catalog?: string;
  concurrency: number;
  limit: number | null;
  video: string | null;
  noR2Upload: boolean;
  noMaterialize: boolean;
  queueOut?: string;
}

interface QueueRow {
  segId: string;
  clipId: string;
  posterPath: string;
  posterR2Key: string;
  posterR2Uploaded: boolean;
  segmentWindow: { start_sec: number; end_sec: number };
  clip: {
    filename: string;
    description: string;
    orientation: "H" | "V";
    source: string;
    legacyTags?: { main: string; secondary: string; third: string };
  };
  siblingTags: string[];
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    write: false,
    concurrency: 4,
    limit: null,
    video: null,
    noR2Upload: false,
    noMaterialize: false,
  };
  const rest = argv.slice(2);
  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i];
    if (flag === "--write") args.write = true;
    else if (flag === "--no-r2-upload") args.noR2Upload = true;
    else if (flag === "--no-materialize") args.noMaterialize = true;
    else if (flag === "--catalog") args.catalog = rest[++i];
    else if (flag.startsWith("--catalog=")) args.catalog = flag.slice("--catalog=".length);
    else if (flag === "--queue-out") args.queueOut = rest[++i];
    else if (flag.startsWith("--queue-out=")) args.queueOut = flag.slice("--queue-out=".length);
    else if (flag === "--video") args.video = rest[++i];
    else if (flag.startsWith("--video=")) args.video = flag.slice("--video=".length);
    else if (flag === "--limit") args.limit = parseIntStrict("--limit", rest[++i]);
    else if (flag.startsWith("--limit=")) args.limit = parseIntStrict("--limit", flag.slice("--limit=".length));
    else if (flag === "--concurrency") args.concurrency = parseIntStrict("--concurrency", rest[++i]);
    else if (flag.startsWith("--concurrency=")) args.concurrency = parseIntStrict("--concurrency", flag.slice("--concurrency=".length));
    else if (flag === "--help" || flag === "-h") {
      printHelpAndExit(0);
    } else {
      console.error(`Unknown argument: ${flag}`);
      printHelpAndExit(1);
    }
  }
  return args;
}

function parseIntStrict(name: string, raw: string | undefined): number {
  if (raw === undefined) throw new Error(`Missing value for ${name}`);
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`Invalid value for ${name}: ${raw}`);
  return Math.floor(n);
}

function printHelpAndExit(code: number): never {
  console.log(`Usage: tsx scripts/prepare-tag-queue.ts [options]

Phase 1 of the catalog tagging handoff: for every segment with empty
tags + empty description, materialise the source, generate the
midpoint poster, mirror it to R2, and emit a queue file the labelling
step can consume.

Options:
  --write              Apply side effects (posters, R2 uploads, queue file).
  --catalog <path>     Catalog path override.
  --concurrency=N      Concurrent workers per video (default 4).
  --limit=N            Process at most N empty segments.
  --video=<id>         Restrict to a single clip.
  --no-r2-upload       Generate posters locally; skip the R2 upload.
  --no-materialize     Skip clips that aren't local (don't pull from R2).
  --queue-out <path>   Output queue path (default runtime/cache/tagging/segment-tag-queue.json).
  --help, -h           Show this message.
`);
  process.exit(code);
}

async function pool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  if (items.length === 0) return;
  let cursor = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (true) {
      const idx = cursor++;
      if (idx >= items.length) return;
      await fn(items[idx]);
    }
  });
  await Promise.all(workers);
}

function computeSiblingTags(clip: ParsedVideo): string[] {
  const set = new Set<string>();
  for (const seg of clip.segments) {
    for (const tag of seg.tags ?? []) {
      if (tag) set.add(tag);
    }
  }
  return Array.from(set);
}

function defaultQueueOut(): string {
  const { cacheDir } = getRuntimePaths();
  return path.join(cacheDir, "tagging", "segment-tag-queue.json");
}

interface Stats {
  empty: number;
  considered: number;
  posterGenerated: number;
  posterCached: number;
  posterFailed: number;
  uploaded: number;
  uploadSkipped: number;
  uploadFailed: number;
  clipsMaterialized: number;
  skippedRemoteOnly: number;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  if (args.catalog) {
    process.env.WEATHER_CATALOG_PATH = path.resolve(args.catalog);
  }

  const queueOutPath = path.resolve(args.queueOut ?? defaultQueueOut());

  const { segmentPostersDir, postersDir } = getRuntimePaths();
  const videosDir = getVideosDir();

  let parsed = parseCatalog(readCatalog());
  if (args.video) parsed = parsed.filter((v) => v.id === args.video);

  const emptyAll = selectEmptySegments(parsed);
  const empty = args.limit ? emptyAll.slice(0, args.limit) : emptyAll;

  console.log(`Catalog videos dir   : ${videosDir}`);
  console.log(`Posters dir          : ${postersDir}`);
  console.log(`Segment posters dir  : ${segmentPostersDir}`);
  console.log(`Queue out            : ${queueOutPath}`);
  console.log(`Empty segments found : ${emptyAll.length}`);
  if (args.limit) console.log(`Limit applied        : first ${args.limit}`);
  if (args.video) console.log(`Restricted to clip   : ${args.video}`);
  console.log(`Mode                 : ${args.write ? "WRITE" : "dry-run"}`);
  console.log(`R2 upload            : ${args.noR2Upload ? "DISABLED" : "enabled"}`);
  console.log(`Materialize remote   : ${args.noMaterialize ? "DISABLED" : "enabled"}`);
  console.log("");

  if (!args.write) {
    console.log("Dry-run: would process the segments above. Re-run with --write to apply.");
    return;
  }

  const stats: Stats = {
    empty: empty.length,
    considered: 0,
    posterGenerated: 0,
    posterCached: 0,
    posterFailed: 0,
    uploaded: 0,
    uploadSkipped: 0,
    uploadFailed: 0,
    clipsMaterialized: 0,
    skippedRemoteOnly: 0,
  };

  fs.mkdirSync(path.dirname(queueOutPath), { recursive: true });
  fs.mkdirSync(segmentPostersDir, { recursive: true });

  const byClip = new Map<string, typeof empty>();
  for (const target of empty) {
    const list = byClip.get(target.clipId) ?? [];
    list.push(target);
    byClip.set(target.clipId, list);
  }

  const wantR2 = !args.noR2Upload && r2Configured();
  if (!args.noR2Upload && !r2Configured()) {
    console.warn("R2 not configured; posters will be local-only. Pass --no-r2-upload to silence this warning.");
  }

  const rows: QueueRow[] = [];

  for (const [clipId, targets] of byClip) {
    let clip = parsed.find((v) => v.id === clipId);
    if (!clip) {
      console.warn(`[${clipId}] not found in parsed catalog; skipping ${targets.length} segments.`);
      continue;
    }

    if (clip.availability !== "local") {
      if (args.noMaterialize) {
        stats.skippedRemoteOnly += targets.length;
        console.warn(`[${clipId}] remote-only and --no-materialize set; skipping ${targets.length} segments.`);
        continue;
      }
      try {
        console.log(`[${clipId}] materializing from R2...`);
        await materializeVideo(clipId);
        stats.clipsMaterialized++;
        parsed = parseCatalog(readCatalog());
        clip = parsed.find((v) => v.id === clipId);
        if (!clip) {
          console.warn(`[${clipId}] disappeared after materialize; skipping.`);
          continue;
        }
      } catch (err) {
        stats.skippedRemoteOnly += targets.length;
        console.error(`[${clipId}] materialize failed:`, err instanceof Error ? err.message : err);
        continue;
      }
    }

    const videoMap = buildVideoMap(parsed);
    const siblingTags = computeSiblingTags(clip);
    const legacyTags = clip.tags && (clip.tags.main || clip.tags.secondary || clip.tags.third)
      ? {
          main: clip.tags.main ?? "",
          secondary: clip.tags.secondary ?? "",
          third: clip.tags.third ?? "",
        }
      : undefined;

    const banner = `[${clipId}] ${targets.length} empty segment${targets.length === 1 ? "" : "s"}`;
    console.log(banner);

    await pool(targets, args.concurrency, async (target) => {
      stats.considered++;
      try {
        const posterPath = await generateSegmentPoster(target.segId, videoMap, false);
        if (!posterPath || !fs.existsSync(posterPath)) {
          stats.posterFailed++;
          console.warn(`  ${target.segId}: poster generation returned no file`);
          return;
        }
        // We can't easily tell "freshly generated" vs "cached" from the
        // helper's return value; count anything that came back as generated.
        // (The ffmpeg call inside is idempotent under the file-mtime check.)
        stats.posterGenerated++;

        const r2Key = tenantKey(`posters/segments/${target.segId}.jpg`);
        let uploaded = false;
        if (wantR2) {
          try {
            await uploadR2File(r2Key, posterPath, "image/jpeg");
            stats.uploaded++;
            uploaded = true;
          } catch (err) {
            stats.uploadFailed++;
            console.error(`  ${target.segId}: R2 upload failed:`, err instanceof Error ? err.message : err);
          }
        } else {
          stats.uploadSkipped++;
        }

        rows.push({
          segId: target.segId,
          clipId,
          posterPath,
          posterR2Key: r2Key,
          posterR2Uploaded: uploaded,
          segmentWindow: { start_sec: target.start_sec, end_sec: target.end_sec },
          clip: {
            filename: clip!.filename,
            description: clip!.description ?? "",
            orientation: clip!.orientation,
            source: clip!.source,
            ...(legacyTags ? { legacyTags } : {}),
          },
          siblingTags,
        });
      } catch (err) {
        stats.posterFailed++;
        console.error(`  ${target.segId} failed:`, err instanceof Error ? err.message : err);
      }
    });
  }

  rows.sort((a, b) => a.segId.localeCompare(b.segId));

  const payload = {
    generated_at: new Date().toISOString(),
    total: rows.length,
    rows,
  };

  const tmpPath = `${queueOutPath}.tmp-${process.pid}`;
  fs.writeFileSync(tmpPath, JSON.stringify(payload, null, 2) + "\n", "utf8");
  fs.renameSync(tmpPath, queueOutPath);

  console.log("");
  console.log("=== Done ===");
  console.log(`Empty segments scanned : ${stats.empty}`);
  console.log(`Segments considered    : ${stats.considered}`);
  console.log(`Clips materialized     : ${stats.clipsMaterialized}`);
  console.log(`Skipped (remote-only)  : ${stats.skippedRemoteOnly}`);
  console.log(`Posters generated      : ${stats.posterGenerated}`);
  console.log(`Posters failed         : ${stats.posterFailed}`);
  console.log(`R2 uploads             : ${stats.uploaded}`);
  console.log(`R2 uploads skipped     : ${stats.uploadSkipped}`);
  console.log(`R2 uploads failed      : ${stats.uploadFailed}`);
  console.log(`Queue rows written     : ${rows.length}`);
  console.log(`Queue file             : ${queueOutPath}`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
