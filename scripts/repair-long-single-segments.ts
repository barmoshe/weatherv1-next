/**
 * Fix catalog rows where a long clip has a single segment whose span is too
 * short for `resegmentCatalog` to split (wrong/stale start_sec/end_sec).
 *
 * 1. Optionally audit-only (default dry-run prints candidates + post-repair split preview).
 * 2. With --write: span-repair → resegmentCatalog → atomic catalog write + backup.
 *
 * Catalog path: --catalog, WEATHER_CATALOG_PATH, or ../v1Drive/weather/notouch!/catalog.json
 * Videos dir: --videos-dir, WEATHER_VIDEOS_DIR, or <catalog-dir>/../videos
 *
 * Usage:
 *   npx tsx scripts/repair-long-single-segments.ts
 *   npx tsx scripts/repair-long-single-segments.ts --write
 *   npx tsx scripts/repair-long-single-segments.ts --video W032
 */

import fs from "node:fs";
import path from "node:path";
import { CatalogSchema, type Catalog } from "@/shared/types";
import { resegmentCatalog } from "@/server/catalog/resegment";
import {
  applyLoneSegmentRepairsToCatalog,
  listLoneSegmentRepairCandidates,
} from "@/server/catalog/repair-long-single-segment";
import { probeVideo } from "@/server/ffmpeg/probe";

interface Args {
  catalogPath: string;
  videosDir: string;
  minWindow: number;
  splitAbove: number;
  write: boolean;
  video: string | null;
}

function defaultCatalogPath(): string {
  const fromEnv = process.env.WEATHER_CATALOG_PATH;
  if (fromEnv && fromEnv.trim()) return path.resolve(fromEnv.trim());
  return path.resolve(process.cwd(), "..", "v1Drive", "weather", "notouch!", "catalog.json");
}

function defaultVideosDir(catalogPath: string): string {
  const fromEnv = process.env.WEATHER_VIDEOS_DIR;
  if (fromEnv && fromEnv.trim()) return path.resolve(fromEnv.trim());
  return path.resolve(path.dirname(catalogPath), "..", "videos");
}

function parseNumberFlag(name: string, raw: string | undefined): number {
  if (raw === undefined) throw new Error(`Missing value for ${name}`);
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`Invalid value for ${name}: ${raw}`);
  return n;
}

function parseArgs(argv: string[]): Args {
  const catalogPath = defaultCatalogPath();
  const args: Args = {
    catalogPath,
    videosDir: defaultVideosDir(catalogPath),
    minWindow: 9,
    splitAbove: 29,
    write: false,
    video: null,
  };

  const rest = argv.slice(2);
  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i];
    if (flag === "--write") args.write = true;
    else if (flag === "--catalog") {
      const val = rest[++i];
      if (!val) throw new Error("--catalog requires a path");
      args.catalogPath = path.resolve(val);
      args.videosDir = defaultVideosDir(args.catalogPath);
    } else if (flag.startsWith("--catalog=")) {
      args.catalogPath = path.resolve(flag.slice("--catalog=".length));
      args.videosDir = defaultVideosDir(args.catalogPath);
    } else if (flag === "--videos-dir") {
      const val = rest[++i];
      if (!val) throw new Error("--videos-dir requires a path");
      args.videosDir = path.resolve(val);
    } else if (flag.startsWith("--videos-dir=")) {
      args.videosDir = path.resolve(flag.slice("--videos-dir=".length));
    } else if (flag === "--min-window") args.minWindow = parseNumberFlag("--min-window", rest[++i]);
    else if (flag.startsWith("--min-window=")) args.minWindow = parseNumberFlag("--min-window", flag.slice("--min-window=".length));
    else if (flag === "--split-above") args.splitAbove = parseNumberFlag("--split-above", rest[++i]);
    else if (flag.startsWith("--split-above=")) args.splitAbove = parseNumberFlag("--split-above", flag.slice("--split-above=".length));
    else if (flag === "--video") {
      const val = rest[++i];
      if (!val) throw new Error("--video requires an id");
      args.video = val;
    } else if (flag.startsWith("--video=")) args.video = flag.slice("--video=".length);
    else if (flag === "--help" || flag === "-h") printHelpAndExit(0);
    else {
      console.error(`Unknown argument: ${flag}`);
      printHelpAndExit(1);
    }
  }
  return args;
}

function printHelpAndExit(code: number): never {
  console.log(`Usage: tsx scripts/repair-long-single-segments.ts [options]

Detects clips with segments.length===1 whose clip duration (catalog or ffprobe)
exceeds --split-above but the lone segment span does not, then widens the
segment to [0, duration] and runs resegmentCatalog (same defaults as
scripts/resegment-catalog.ts).

Options:
  --catalog <path>         catalog.json (default: WEATHER_CATALOG_PATH or ../v1Drive/.../catalog.json)
  --videos-dir <path>      Local videos folder for ffprobe (default: parental ../videos)
  --min-window <sec>       resegment window floor (default: 9)
  --split-above <sec>      repair + split threshold (default: 29)
  --video <id>             Only process this clip id
  --write                  Apply repair + resegment + backup
  --help, -h               Show this message.
`);
  process.exit(code);
}

function readCatalogFromDisk(catalogPath: string): Catalog {
  if (!fs.existsSync(catalogPath)) throw new Error(`Catalog file not found: ${catalogPath}`);
  const raw = fs.readFileSync(catalogPath, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to JSON.parse ${catalogPath}: ${message}`);
  }
  return CatalogSchema.parse(parsed);
}

function writeCatalogAtomic(catalogPath: string, catalog: Catalog): string {
  const text = JSON.stringify(catalog, null, 2) + "\n";
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = `${catalogPath}.before-repair-resegment-${ts}`;
  fs.copyFileSync(catalogPath, backupPath);
  const tmpPath = `${catalogPath}.repair-resegment-tmp-${process.pid}`;
  fs.writeFileSync(tmpPath, text, "utf8");
  fs.renameSync(tmpPath, catalogPath);
  return backupPath;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);

  console.log(`Catalog:     ${args.catalogPath}`);
  console.log(`Videos dir:  ${args.videosDir}`);
  console.log(`Min window:  ${args.minWindow}s`);
  console.log(`Split above: ${args.splitAbove}s`);
  console.log(`Mode:        ${args.write ? "WRITE" : "dry-run"}`);
  if (args.video) console.log(`Restrict:    ${args.video}`);
  console.log("");

  let catalog = readCatalogFromDisk(args.catalogPath);
  if (args.video) {
    catalog = {
      ...catalog,
      videos: catalog.videos.filter((v) => v.id === args.video),
    };
    if (catalog.videos.length === 0) {
      console.error(`No video with id ${args.video} in catalog.`);
      process.exit(1);
    }
  }

  // Sequential probe (simple; candidate count is small)
  const durationById = new Map<string, number>();
  const metaById = new Map<string, { duration_sec?: number; orientation?: "H" | "V" }>();
  for (const entry of catalog.videos) {
    if (!entry.id) continue;
    const filePath = path.join(args.videosDir, entry.filename);
    let probed = 0;
    let orientation: "H" | "V" | undefined;
    if (fs.existsSync(filePath)) {
      try {
        const p = await probeVideo(filePath);
        probed = p.durationSec;
        orientation = p.orientation;
      } catch {
        probed = 0;
      }
    }
    const effective = Math.max(entry.duration_sec ?? 0, probed);
    durationById.set(entry.id, effective);
    if (fs.existsSync(filePath) && probed > 0) {
      metaById.set(entry.id, { duration_sec: probed, orientation });
    }
  }

  const getEff = (entry: (typeof catalog.videos)[0]) => durationById.get(entry.id) ?? (entry.duration_sec ?? 0);

  const candidates = listLoneSegmentRepairCandidates(catalog, getEff, { splitAbove: args.splitAbove });
  console.log(`Repair candidates: ${candidates.length}`);
  for (const c of candidates) {
    console.log(
      `  ${c.videoId}  ${c.filename}  eff=${c.effectiveDurationSec.toFixed(2)}s  span was ${c.before.span.toFixed(2)}s [${c.before.start_sec}, ${c.before.end_sec}]`,
    );
  }
  console.log("");

  const repaired = applyLoneSegmentRepairsToCatalog(
    catalog,
    getEff,
    (entry) => metaById.get(entry.id),
    { splitAbove: args.splitAbove },
  );

  const { catalog: resegmented, changes, summary } = resegmentCatalog(repaired, {
    minWindow: args.minWindow,
    splitAbove: args.splitAbove,
  });

  const changedAfterResegment = changes.filter((c) => c.newCount !== c.oldCount);
  for (const change of changedAfterResegment) {
    console.log(
      `  After repair+resegment ${change.videoId}: ${change.oldCount} -> ${change.newCount} segments (splits: ${change.splitsBySegment.join(", ")})`,
    );
  }
  console.log("");
  console.log(
    `Summary: ${summary.videosChanged}/${summary.videos} videos changed by resegment; ` +
      `${summary.segmentsBefore} -> ${summary.segmentsAfter} segments`,
  );

  if (!args.write) {
    console.log("");
    console.log("Dry-run only. Re-run with --write to apply.");
    return;
  }

  if (candidates.length === 0 && summary.segmentsBefore === summary.segmentsAfter) {
    console.log("No repair candidates and no resegment delta in this scope; nothing to write.");
    return;
  }

  // If --video was used we must merge back into full catalog on disk
  let fullOut: Catalog;
  if (args.video) {
    const full = readCatalogFromDisk(args.catalogPath);
    const byId = new Map(resegmented.videos.map((v) => [v.id, v]));
    fullOut = {
      ...full,
      videos: full.videos.map((v) => byId.get(v.id) ?? v),
      updated_at: new Date().toISOString(),
    };
    CatalogSchema.parse(fullOut);
  } else {
    fullOut = resegmented;
    CatalogSchema.parse(fullOut);
  }

  const backupPath = writeCatalogAtomic(args.catalogPath, fullOut);
  console.log("");
  console.log(`Backup written:  ${backupPath}`);
  console.log(`Catalog updated: ${args.catalogPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
