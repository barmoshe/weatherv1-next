/**
 * List or download catalog videos whose files are absent under WEATHER_VIDEOS_DIR
 * (same check as parseCatalog / catalog "missing" health).
 *
 * When a row has `remote.key` and R2 is configured (`R2_SYNC_ENABLED=1` + gateway
 * credentials), `--write` calls `materializeVideo` for each missing id.
 *
 * Usage:
 *   npx tsx scripts/materialize-missing-videos.ts
 *   npx tsx scripts/materialize-missing-videos.ts --write
 *   npx tsx scripts/materialize-missing-videos.ts --write --concurrency=3
 *   npx tsx scripts/materialize-missing-videos.ts --video IB019
 *
 * Paths follow getRuntimeConfig() (WEATHER_WORKSPACE_DIR, WEATHER_CATALOG_PATH,
 * WEATHER_VIDEOS_DIR, R2_* env — see src/server/runtime/config.ts).
 */

import fs from "node:fs";
import path from "node:path";
import { readCatalog, getVideosDir } from "@/server/catalog/storage";
import { r2Configured } from "@/server/sync/r2/client";
import { materializeVideo } from "@/server/sync/r2/service";

interface Args {
  write: boolean;
  concurrency: number;
  video: string | null;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { write: false, concurrency: 2, video: null };
  const rest = argv.slice(2);
  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i];
    if (flag === "--write") args.write = true;
    else if (flag === "--video") {
      const v = rest[++i];
      if (!v) throw new Error("--video requires an id");
      args.video = v;
    } else if (flag.startsWith("--video=")) args.video = flag.slice("--video=".length);
    else if (flag === "--concurrency") {
      const v = rest[++i];
      if (!v) throw new Error("--concurrency requires a number");
      args.concurrency = parsePositiveInt("--concurrency", v);
    } else if (flag.startsWith("--concurrency=")) {
      args.concurrency = parsePositiveInt("--concurrency", flag.slice("--concurrency=".length));
    } else if (flag === "--help" || flag === "-h") {
      console.log(`materialize-missing-videos — pull missing catalog files from R2 when possible.

Default: print missing ids grouped by whether R2 key is present (dry-run).
With --write: download for rows that have remote.key (requires R2 env).

Flags:
  --write              Call materializeVideo for each missing file with remote.key
  --concurrency=N      Parallel downloads (default 2)
  --video=<id>         Only consider this catalog id
  --help, -h           This text
`);
      process.exit(0);
    } else {
      console.error(`Unknown argument: ${flag}`);
      process.exit(1);
    }
  }
  return args;
}

function parsePositiveInt(name: string, raw: string): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) throw new Error(`Invalid ${name}: ${raw}`);
  return Math.floor(n);
}

interface MissingRow {
  id: string;
  filename: string;
  r2Key: string | undefined;
}

async function mapWithConcurrency<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<void>
): Promise<void> {
  let next = 0;
  const n = Math.max(1, Math.min(concurrency, items.length || 1));
  const worker = async (): Promise<void> => {
    while (true) {
      const idx = next++;
      if (idx >= items.length) return;
      await fn(items[idx]!);
    }
  };
  await Promise.all(Array.from({ length: n }, () => worker()));
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  const catalog = readCatalog();
  const videosDir = getVideosDir();

  const missing: MissingRow[] = [];
  for (const v of catalog.videos) {
    if (!v.id || !v.filename) continue;
    if (args.video && v.id !== args.video) continue;
    const localPath = path.join(videosDir, v.filename);
    if (!fs.existsSync(localPath)) {
      missing.push({ id: v.id, filename: v.filename, r2Key: v.remote?.key });
    }
  }

  const withKey = missing.filter((m) => Boolean(m.r2Key));
  const noKey = missing.filter((m) => !m.r2Key);

  console.log(`Videos dir: ${videosDir}`);
  console.log(`Missing on disk: ${missing.length} (with R2 key: ${withKey.length}, no key: ${noKey.length})`);

  if (noKey.length) {
    console.log("\nMissing file and no remote.key (restore manually or fix catalog):");
    console.log(noKey.map((m) => m.id).join(", "));
  }

  if (!withKey.length) {
    if (args.write && missing.length) {
      console.error("\nNothing to pull from R2 (no remote.key on missing rows).");
      process.exit(1);
    }
    return;
  }

  if (!args.write) {
    console.log("\nDry-run — would materialize from R2:");
    console.log(withKey.map((m) => m.id).join(", "));
    console.log("\nPass --write to download.");
    return;
  }

  if (!r2Configured()) {
    console.error("R2 is not configured (need R2_SYNC_ENABLED=1 and gateway credentials). See src/server/runtime/config.ts.");
    process.exit(1);
  }

  let ok = 0;
  let failed = 0;
  await mapWithConcurrency(withKey, args.concurrency, async (row) => {
    try {
      console.log(`[${row.id}] materialize…`);
      await materializeVideo(row.id);
      ok++;
      console.log(`[${row.id}] ok`);
    } catch (e) {
      failed++;
      console.error(`[${row.id}] failed:`, e instanceof Error ? e.message : e);
    }
  });

  console.log(`\nDone. ok=${ok} failed=${failed}`);
  if (failed) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
