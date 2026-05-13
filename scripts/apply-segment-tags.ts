/**
 * Phase 3 of the catalog-empty-segment tagging handoff
 * (see docs/CATALOG_TAGGING_HANDOFF.md).
 *
 * Reads the result shards produced by the labelling phase, validates
 * every result against TAG_VOCAB, applies the (tags, description) pair
 * to the matching segment in the canonical catalog, writes a
 * timestamped backup, and (unless --no-r2-upload) pushes the updated
 * catalog to R2.
 *
 * The catalog itself is touched through `writeCatalog()` so the atomic
 * temp-file + rename + cache invalidation behaviour is preserved.
 *
 * Defaults to dry-run.
 *
 * Flags:
 *   --write              Actually write the catalog + push to R2.
 *   --results-dir <dir>  Directory containing segment-tag-results.part-*.json
 *                        (default: runtime/cache/tagging).
 *   --results <glob>     Comma-separated list of result file paths to use
 *                        instead of the default glob.
 *   --catalog <path>     Catalog override.
 *   --no-r2-upload       Skip the pushCatalogToR2 step (poster + catalog
 *                        mirror is deferred to the user).
 *   --help, -h           Show this message.
 */

import fs from "node:fs";
import path from "node:path";
import { CatalogSchema } from "@/shared/types";
import { readCatalog, writeCatalog, getCatalogPath } from "@/server/catalog/storage";
import { parseCatalog } from "@/server/catalog/parser";
import { applyTagsToCatalog, selectEmptySegments } from "@/server/catalog/tagging";
import { isVocabValue } from "@/server/tag-vocab";
import { pushCatalogToR2, R2CatalogConflictError } from "@/server/sync/r2/service";
import { r2Configured } from "@/server/sync/r2/client";

interface Args {
  write: boolean;
  resultsDir?: string;
  results?: string[];
  catalog?: string;
  noR2Upload: boolean;
}

interface ResultRow {
  segId: string;
  tags: string[];
  description: string;
  skipped?: boolean;
  note?: string;
}

interface ResultShardFile {
  shard?: number;
  total?: number;
  results: ResultRow[];
}

function parseArgs(argv: string[]): Args {
  const args: Args = { write: false, noR2Upload: false };
  const rest = argv.slice(2);
  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i];
    if (flag === "--write") args.write = true;
    else if (flag === "--no-r2-upload") args.noR2Upload = true;
    else if (flag === "--results-dir") args.resultsDir = rest[++i];
    else if (flag.startsWith("--results-dir=")) args.resultsDir = flag.slice("--results-dir=".length);
    else if (flag === "--results") args.results = (rest[++i] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    else if (flag.startsWith("--results=")) args.results = flag.slice("--results=".length).split(",").map((s) => s.trim()).filter(Boolean);
    else if (flag === "--catalog") args.catalog = rest[++i];
    else if (flag.startsWith("--catalog=")) args.catalog = flag.slice("--catalog=".length);
    else if (flag === "--help" || flag === "-h") printHelpAndExit(0);
    else {
      console.error(`Unknown argument: ${flag}`);
      printHelpAndExit(1);
    }
  }
  return args;
}

function printHelpAndExit(code: number): never {
  console.log(`Usage: tsx scripts/apply-segment-tags.ts [options]

Apply segment-tag-results.part-*.json files to the canonical catalog.

Options:
  --write              Actually write the catalog + push to R2.
  --results-dir <dir>  Directory with segment-tag-results.part-*.json
                       (default: runtime/cache/tagging).
  --results <list>     Comma-separated explicit result files (overrides --results-dir).
  --catalog <path>     Catalog path override (sets WEATHER_CATALOG_PATH).
  --no-r2-upload       Skip pushCatalogToR2.
  --help, -h           Show this message.
`);
  process.exit(code);
}

function defaultResultsDir(): string {
  return path.resolve(process.cwd(), "runtime", "cache", "tagging");
}

function loadResultFiles(args: Args): string[] {
  if (args.results && args.results.length > 0) {
    return args.results.map((p) => path.resolve(p));
  }
  const dir = path.resolve(args.resultsDir ?? defaultResultsDir());
  if (!fs.existsSync(dir)) {
    throw new Error(`Results directory not found: ${dir}`);
  }
  const files = fs
    .readdirSync(dir)
    .filter((name) => /^segment-tag-results\.part-\d+\.json$/.test(name))
    .map((name) => path.join(dir, name))
    .sort();
  if (files.length === 0) {
    throw new Error(`No segment-tag-results.part-*.json files in ${dir}`);
  }
  return files;
}

interface MergedResults {
  byId: Map<string, ResultRow>;
  conflicts: string[];
  skipped: ResultRow[];
  invalid: ResultRow[];
  filesRead: number;
  rowsRead: number;
}

function mergeResults(files: string[]): MergedResults {
  const byId = new Map<string, ResultRow>();
  const conflicts: string[] = [];
  const skipped: ResultRow[] = [];
  const invalid: ResultRow[] = [];
  let rowsRead = 0;

  for (const file of files) {
    const raw = fs.readFileSync(file, "utf8");
    const parsed = JSON.parse(raw) as ResultShardFile;
    if (!Array.isArray(parsed.results)) {
      throw new Error(`Malformed results file (no \`results\` array): ${file}`);
    }
    for (const row of parsed.results) {
      rowsRead++;
      if (!row || typeof row.segId !== "string" || !row.segId) {
        invalid.push(row);
        continue;
      }
      if (row.skipped) {
        skipped.push(row);
        continue;
      }
      if (byId.has(row.segId)) {
        conflicts.push(row.segId);
        continue;
      }
      byId.set(row.segId, row);
    }
  }

  return { byId, conflicts, skipped, invalid, filesRead: files.length, rowsRead };
}

function writeBackup(catalogPath: string): string {
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = `${catalogPath}.before-tagging-${ts}`;
  fs.copyFileSync(catalogPath, backupPath);
  return backupPath;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  if (args.catalog) {
    process.env.WEATHER_CATALOG_PATH = path.resolve(args.catalog);
  }

  const files = loadResultFiles(args);
  const merged = mergeResults(files);

  console.log(`Result files     : ${merged.filesRead}`);
  for (const f of files) console.log(`  - ${f}`);
  console.log(`Rows read        : ${merged.rowsRead}`);
  console.log(`Unique applied   : ${merged.byId.size}`);
  console.log(`Skipped (frame)  : ${merged.skipped.length}`);
  console.log(`Conflicts (dupes): ${merged.conflicts.length}`);
  console.log(`Invalid rows     : ${merged.invalid.length}`);

  // Defensive re-check: confirm targets are still empty in the catalog.
  const catalogPath = getCatalogPath();
  const catalog = readCatalog();
  const parsed = parseCatalog(catalog);
  const stillEmpty = new Set(selectEmptySegments(parsed).map((s) => s.segId));

  const MAX_TAGS = 7;
  const targets: { segId: string; tags: string[]; description: string }[] = [];
  let raceSkipped = 0;
  let unknownTagsPreview = 0;
  let truncatedToMax = 0;
  let noTargetSeg = 0;

  for (const [segId, row] of merged.byId) {
    if (!stillEmpty.has(segId)) {
      const exists = parsed.some((v) => v.segments.some((s) => s.id === segId));
      if (exists) raceSkipped++;
      else noTargetSeg++;
      continue;
    }
    const filteredTags: string[] = [];
    const seen = new Set<string>();
    for (const t of row.tags ?? []) {
      if (typeof t === "string") {
        const trimmed = t.trim();
        if (!trimmed) continue;
        if (!isVocabValue(trimmed)) {
          unknownTagsPreview++;
          continue;
        }
        if (seen.has(trimmed)) continue;
        seen.add(trimmed);
        filteredTags.push(trimmed);
      } else if (t) {
        unknownTagsPreview++;
      }
    }
    let finalTags = filteredTags;
    if (filteredTags.length > MAX_TAGS) {
      truncatedToMax++;
      finalTags = filteredTags.slice(0, MAX_TAGS);
    }
    targets.push({ segId, tags: finalTags, description: (row.description ?? "").trim() });
  }

  console.log("");
  console.log(`Catalog          : ${catalogPath}`);
  console.log(`Empty in catalog : ${stillEmpty.size}`);
  console.log(`Race-skipped     : ${raceSkipped} (segment now tagged in catalog)`);
  console.log(`Unknown segIds   : ${noTargetSeg}`);
  console.log(`Targets to apply : ${targets.length}`);
  console.log(`Unknown tags     : ${unknownTagsPreview} (will be dropped by applyTagsToCatalog)`);
  console.log(`Truncated >${MAX_TAGS}    : ${truncatedToMax}`);

  if (targets.length === 0) {
    console.log("");
    console.log("Nothing to apply.");
    return;
  }

  const result = applyTagsToCatalog(catalog, targets);
  console.log("");
  console.log(`After apply       : applied=${result.applied}, skippedAlreadyTagged=${result.skippedAlreadyTagged}, unknownTagsDropped=${result.unknownTagsDropped}, notFound=${result.notFound.length}`);

  CatalogSchema.parse(result.catalog);

  if (!args.write) {
    console.log("");
    console.log("Dry-run only. Re-run with --write to persist + push.");
    return;
  }

  const backupPath = writeBackup(catalogPath);
  console.log("");
  console.log(`Backup written   : ${backupPath}`);

  await writeCatalog(result.catalog);
  console.log(`Catalog updated  : ${catalogPath}`);

  if (args.noR2Upload) {
    console.log("R2 push          : skipped (--no-r2-upload)");
    return;
  }
  if (!r2Configured()) {
    console.log("R2 push          : skipped (R2 not configured in this environment)");
    return;
  }

  try {
    const status = await pushCatalogToR2();
    console.log(`R2 push          : ok (etag=${status.lastCatalogEtag ?? "?"})`);
  } catch (err) {
    if (err instanceof R2CatalogConflictError) {
      console.error("");
      console.error("R2 push aborted: remote catalog has changed since the last known etag.");
      console.error("Run `pullCatalogFromR2` (or Settings -> Pull) to reconcile, then re-run this script.");
      process.exit(2);
    }
    throw err;
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
