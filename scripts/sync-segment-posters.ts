/**
 * Generate posters for every clip and every segment in the catalog and
 * upload them to R2 under:
 *   tenants/<tenant>/posters/clips/<videoId>.jpg
 *   tenants/<tenant>/posters/segments/<segmentId>.jpg
 *
 * Local sources only — videos missing from local disk are skipped (use
 * the materialize/pull flows first if you need to fetch them).
 *
 * Required env (or .env.local):
 *   R2_SYNC_ENABLED=1
 *   R2_GATEWAY_URL=https://weatherv1-r2-gateway.<subdomain>.workers.dev
 *   R2_TENANT_ID=default
 *   R2_BUCKET_NAME=weatherv1-media
 *   R2_APP_USERNAME=<worker basic-auth user>
 *   R2_APP_PASSWORD=<worker basic-auth password>
 *
 * Optional flags:
 *   --force            Re-generate posters and re-upload even if cached / present in R2
 *   --skip-clips       Only generate segment posters
 *   --skip-segments    Only generate clip posters
 *   --concurrency=N    Concurrent uploads per video (default 4)
 *   --videos=N         Process only first N videos (debug)
 */

import fs from "node:fs";
import path from "node:path";
import { getRuntimeConfig } from "@/server/runtime/config";
import { getRuntimePaths } from "@/server/runtime/paths";
import { getVideosDir, readCatalog } from "@/server/catalog/storage";
import { parseCatalog } from "@/server/catalog/parser";
import { generateAt, generatePoster } from "@/server/ffmpeg/posters";
import {
  headR2Object,
  r2Configured,
  tenantKey,
  uploadR2File,
} from "@/server/sync/r2/client";

interface Args {
  force: boolean;
  skipClips: boolean;
  skipSegments: boolean;
  concurrency: number;
  videosLimit: number | null;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    force: false,
    skipClips: false,
    skipSegments: false,
    concurrency: 4,
    videosLimit: null,
  };
  for (const raw of argv.slice(2)) {
    if (raw === "--force") args.force = true;
    else if (raw === "--skip-clips") args.skipClips = true;
    else if (raw === "--skip-segments") args.skipSegments = true;
    else if (raw.startsWith("--concurrency=")) {
      const n = Number(raw.split("=")[1]);
      if (Number.isFinite(n) && n > 0) args.concurrency = Math.floor(n);
    } else if (raw.startsWith("--videos=")) {
      const n = Number(raw.split("=")[1]);
      if (Number.isFinite(n) && n > 0) args.videosLimit = Math.floor(n);
    } else {
      throw new Error(`Unknown argument: ${raw}`);
    }
  }
  return args;
}

async function pool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
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

interface Stats {
  clipsGenerated: number;
  clipsUploaded: number;
  clipsSkipped: number;
  clipsFailed: number;
  segmentsGenerated: number;
  segmentsUploaded: number;
  segmentsSkipped: number;
  segmentsFailed: number;
  videosSkippedNoLocal: number;
}

async function uploadIfNeeded(key: string, filePath: string, force: boolean): Promise<"uploaded" | "skipped"> {
  if (!force) {
    const head = await headR2Object(key);
    if (head?.etag) return "skipped";
  }
  await uploadR2File(key, filePath, "image/jpeg");
  return "uploaded";
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);

  if (!r2Configured()) {
    const cfg = getRuntimeConfig().r2;
    console.error("R2 sync is not configured. Required env vars:");
    console.error("  R2_SYNC_ENABLED=1");
    console.error("  R2_GATEWAY_URL");
    console.error("  R2_TENANT_ID");
    console.error("  R2_APP_USERNAME");
    console.error("  R2_APP_PASSWORD");
    console.error("Got:", {
      enabled: cfg.enabled,
      gatewayUrl: cfg.gatewayUrl,
      tenantId: cfg.tenantId,
      appUsername: cfg.appUsername,
      hasPassword: Boolean(cfg.appPassword),
    });
    process.exit(2);
  }

  const cfg = getRuntimeConfig();
  const { postersDir, segmentPostersDir } = getRuntimePaths();
  const videosDir = getVideosDir();

  fs.mkdirSync(postersDir, { recursive: true });
  fs.mkdirSync(segmentPostersDir, { recursive: true });

  const catalog = readCatalog();
  const parsed = parseCatalog(catalog, videosDir);
  const subset = args.videosLimit ? parsed.slice(0, args.videosLimit) : parsed;

  console.log(`R2 gateway   : ${cfg.r2.gatewayUrl}`);
  console.log(`R2 tenant    : ${cfg.r2.tenantId}`);
  console.log(`R2 bucket    : ${cfg.r2.bucketName ?? "(from gateway)"}`);
  console.log(`Videos dir   : ${videosDir}`);
  console.log(`Posters dir  : ${postersDir}`);
  console.log(`Segments dir : ${segmentPostersDir}`);
  console.log(`Catalog      : ${parsed.length} videos`);
  if (args.videosLimit) console.log(`Limit        : first ${args.videosLimit} videos`);
  console.log(`Force        : ${args.force}`);
  console.log(`Concurrency  : ${args.concurrency}`);
  console.log("");

  const stats: Stats = {
    clipsGenerated: 0,
    clipsUploaded: 0,
    clipsSkipped: 0,
    clipsFailed: 0,
    segmentsGenerated: 0,
    segmentsUploaded: 0,
    segmentsSkipped: 0,
    segmentsFailed: 0,
    videosSkippedNoLocal: 0,
  };

  let videoIdx = 0;
  for (const video of subset) {
    videoIdx++;
    const localPath = path.join(videosDir, video.filename);
    const segCount = video.segments?.length ?? 0;
    const banner = `[${videoIdx}/${subset.length}] ${video.id} (${segCount} segments)`;

    if (!fs.existsSync(localPath)) {
      stats.videosSkippedNoLocal++;
      console.log(`${banner} -- SKIP (no local file: ${video.filename})`);
      continue;
    }

    process.stdout.write(`${banner}`);

    if (!args.skipClips) {
      try {
        const clipPosterPath = await generatePoster(localPath, video.id, postersDir, args.force);
        if (clipPosterPath && fs.existsSync(clipPosterPath)) {
          stats.clipsGenerated++;
          const key = tenantKey(`posters/clips/${video.id}.jpg`);
          const result = await uploadIfNeeded(key, clipPosterPath, args.force);
          if (result === "uploaded") stats.clipsUploaded++;
          else stats.clipsSkipped++;
        }
      } catch (err) {
        stats.clipsFailed++;
        console.error(`\n  clip ${video.id} failed:`, err instanceof Error ? err.message : err);
      }
    }

    if (!args.skipSegments && segCount > 0) {
      let upCount = 0;
      let skipCount = 0;
      let failCount = 0;
      await pool(video.segments, args.concurrency, async (segment) => {
        if (!segment.id) return;
        const start = Number(segment.start_sec ?? 0);
        const end = Number(segment.end_sec ?? 0);
        const midpoint = end > start ? (start + end) / 2 : start;
        try {
          const posterPath = await generateAt(localPath, segment.id, midpoint, segmentPostersDir, args.force);
          if (!posterPath || !fs.existsSync(posterPath)) {
            failCount++;
            stats.segmentsFailed++;
            return;
          }
          stats.segmentsGenerated++;
          const key = tenantKey(`posters/segments/${segment.id}.jpg`);
          const result = await uploadIfNeeded(key, posterPath, args.force);
          if (result === "uploaded") {
            upCount++;
            stats.segmentsUploaded++;
          } else {
            skipCount++;
            stats.segmentsSkipped++;
          }
        } catch (err) {
          failCount++;
          stats.segmentsFailed++;
          console.error(`\n  segment ${segment.id} failed:`, err instanceof Error ? err.message : err);
        }
      });
      process.stdout.write(`  segments: ${upCount} uploaded, ${skipCount} skipped, ${failCount} failed`);
    }
    process.stdout.write("\n");
  }

  console.log("");
  console.log("=== Done ===");
  console.log(`Videos processed       : ${subset.length - stats.videosSkippedNoLocal} of ${subset.length}`);
  console.log(`Videos skipped (no local): ${stats.videosSkippedNoLocal}`);
  console.log(`Clip posters generated : ${stats.clipsGenerated}`);
  console.log(`Clip posters uploaded  : ${stats.clipsUploaded}`);
  console.log(`Clip posters skipped   : ${stats.clipsSkipped}`);
  console.log(`Clip posters failed    : ${stats.clipsFailed}`);
  console.log(`Segment posters generated: ${stats.segmentsGenerated}`);
  console.log(`Segment posters uploaded : ${stats.segmentsUploaded}`);
  console.log(`Segment posters skipped  : ${stats.segmentsSkipped}`);
  console.log(`Segment posters failed   : ${stats.segmentsFailed}`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
