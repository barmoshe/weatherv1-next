/**
 * One-shot catalog re-segmentation CLI.
 *
 * Splits every catalog segment longer than `--split-above` seconds into N
 * equal-length consecutive windows of at least `--min-window` seconds.
 * The first new window inherits tags / description / confidence; the rest
 * get empty tags and empty description.
 *
 * Defaults: split segments > 29s into windows >= 9s.
 *
 * Defaults to a dry-run that prints a per-video summary. Pass `--write` to
 * mutate `catalog.json` (an atomic rename, with a timestamped backup next
 * to the original).
 *
 * Catalog path resolution order:
 *   1. `--catalog <path>`
 *   2. `$WEATHER_CATALOG_PATH`
 *   3. `<repo>/../v1Drive/weather/notouch!/catalog.json`
 *
 * Usage:
 *   npx tsx scripts/resegment-catalog.ts                 # dry-run
 *   npx tsx scripts/resegment-catalog.ts --write         # apply + backup
 *   npx tsx scripts/resegment-catalog.ts --min-window 9 --split-above 29
 *
 * This script is intentionally self-contained: it imports the pure
 * `resegmentCatalog` helper and reads/writes the catalog JSON directly so
 * the Next runtime config / asset source do not need to be initialised.
 */

import fs from "node:fs";
import path from "node:path";
import { CatalogSchema, type Catalog } from "@/shared/types";
import { resegmentCatalog } from "@/server/catalog/resegment";

interface Args {
  catalogPath: string;
  minWindow: number;
  splitAbove: number;
  write: boolean;
}

function defaultCatalogPath(): string {
  const fromEnv = process.env.WEATHER_CATALOG_PATH;
  if (fromEnv && fromEnv.trim()) return path.resolve(fromEnv.trim());
  return path.resolve(process.cwd(), "..", "v1Drive", "weather", "notouch!", "catalog.json");
}

function parseNumberFlag(name: string, raw: string | undefined): number {
  if (raw === undefined) throw new Error(`Missing value for ${name}`);
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`Invalid value for ${name}: ${raw}`);
  }
  return n;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    catalogPath: defaultCatalogPath(),
    minWindow: 9,
    splitAbove: 29,
    write: false,
  };

  const rest = argv.slice(2);
  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i];
    if (flag === "--write") {
      args.write = true;
    } else if (flag === "--catalog") {
      const val = rest[++i];
      if (!val) throw new Error("--catalog requires a path");
      args.catalogPath = path.resolve(val);
    } else if (flag.startsWith("--catalog=")) {
      args.catalogPath = path.resolve(flag.slice("--catalog=".length));
    } else if (flag === "--min-window") {
      args.minWindow = parseNumberFlag("--min-window", rest[++i]);
    } else if (flag.startsWith("--min-window=")) {
      args.minWindow = parseNumberFlag("--min-window", flag.slice("--min-window=".length));
    } else if (flag === "--split-above") {
      args.splitAbove = parseNumberFlag("--split-above", rest[++i]);
    } else if (flag.startsWith("--split-above=")) {
      args.splitAbove = parseNumberFlag("--split-above", flag.slice("--split-above=".length));
    } else if (flag === "--help" || flag === "-h") {
      printHelpAndExit(0);
    } else {
      console.error(`Unknown argument: ${flag}`);
      printHelpAndExit(1);
    }
  }
  return args;
}

function printHelpAndExit(code: number): never {
  console.log(`Usage: tsx scripts/resegment-catalog.ts [options]

Options:
  --catalog <path>        Path to catalog.json (default: env WEATHER_CATALOG_PATH or ../v1Drive/weather/notouch!/catalog.json)
  --min-window <seconds>  Minimum window length (default: 9)
  --split-above <seconds> Only split segments longer than this (default: 29)
  --write                 Apply the changes. Without this flag the script is a dry-run.
  --help, -h              Show this message.
`);
  process.exit(code);
}

function readCatalogFromDisk(catalogPath: string): Catalog {
  if (!fs.existsSync(catalogPath)) {
    throw new Error(`Catalog file not found: ${catalogPath}`);
  }
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
  const backupPath = `${catalogPath}.before-resegment-${ts}`;
  fs.copyFileSync(catalogPath, backupPath);

  const tmpPath = `${catalogPath}.resegment-tmp-${process.pid}`;
  fs.writeFileSync(tmpPath, text, "utf8");
  fs.renameSync(tmpPath, catalogPath);
  return backupPath;
}

async function main() {
  const args = parseArgs(process.argv);

  console.log(`Catalog:      ${args.catalogPath}`);
  console.log(`Min window:   ${args.minWindow}s`);
  console.log(`Split above:  ${args.splitAbove}s`);
  console.log(`Mode:         ${args.write ? "WRITE" : "dry-run"}`);
  console.log("");

  const original = readCatalogFromDisk(args.catalogPath);
  const { catalog: rewritten, changes, summary } = resegmentCatalog(original, {
    minWindow: args.minWindow,
    splitAbove: args.splitAbove,
  });

  const changedVideos = changes.filter((c) => c.newCount !== c.oldCount);
  for (const change of changedVideos) {
    console.log(
      `  ${change.videoId}: ${change.oldCount} -> ${change.newCount} segments (splits: ${change.splitsBySegment.join(", ")})`,
    );
  }

  console.log("");
  console.log(
    `Summary: ${summary.videosChanged}/${summary.videos} videos changed; ` +
      `${summary.segmentsBefore} -> ${summary.segmentsAfter} segments`,
  );

  if (!args.write) {
    console.log("");
    console.log("Dry-run only. Re-run with --write to apply.");
    return;
  }

  if (summary.segmentsBefore === summary.segmentsAfter) {
    console.log("No changes to write.");
    return;
  }

  // Validate the rewritten catalog before we replace anything on disk.
  CatalogSchema.parse(rewritten);

  const backupPath = writeCatalogAtomic(args.catalogPath, rewritten);
  console.log("");
  console.log(`Backup written:  ${backupPath}`);
  console.log(`Catalog updated: ${args.catalogPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
