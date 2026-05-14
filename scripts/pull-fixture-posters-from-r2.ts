/**
 * Download segment poster JPEGs from R2 into local segment poster cache
 * (`runtime/cache/segment_posters/<segmentId>.jpg`).
 *
 * Loads `.env.local` when present (same pattern as other scripts — no dotenv dep).
 *
 * Required when pulling (mirror sync-segment-posters key layout):
 *   R2_SYNC_ENABLED=1
 *   R2_GATEWAY_URL=…
 *   R2_TENANT_ID=default
 *   R2_BUCKET_NAME=…
 *   R2_APP_USERNAME / R2_APP_PASSWORD
 *
 * Usage:
 *   ./node_modules/.bin/vite-node --config vitest.config.ts scripts/pull-fixture-posters-from-r2.ts
 *   ./node_modules/.bin/vite-node --config vitest.config.ts scripts/pull-fixture-posters-from-r2.ts IB004-s0 IB005-s1
 */

import fs from "node:fs";
import path from "node:path";

const envPath = path.resolve(process.cwd(), ".env.local");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 1) continue;
    const k = trimmed.slice(0, eq).trim();
    let v = trimmed.slice(eq + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    if (process.env[k] === undefined) process.env[k] = v;
  }
}

import { resetRuntimeConfigForTests } from "@/server/runtime/config";
import { getRuntimePaths } from "@/server/runtime/paths";
import { downloadR2File, r2Configured, tenantKey } from "@/server/sync/r2/client";

const DEFAULT_SEGMENTS = ["IB001-s0", "IB002-s0", "IB003-s0"];

async function main(): Promise<void> {
  resetRuntimeConfigForTests();

  if (!r2Configured()) {
    console.error(
      JSON.stringify(
        {
          error: "r2_not_configured",
          hint: "Set R2_SYNC_ENABLED=1 and gateway / tenant / Basic Auth (see docs/fixtures/README.md).",
        },
        null,
        2,
      ),
    );
    process.exit(1);
  }

  const ids = process.argv.slice(2).filter(Boolean);
  const segments = ids.length > 0 ? ids : DEFAULT_SEGMENTS;

  const { segmentPostersDir } = getRuntimePaths();
  fs.mkdirSync(segmentPostersDir, { recursive: true });

  const results: Array<{ segmentId: string; ok: boolean; bytes?: number; error?: string }> = [];

  for (const segmentId of segments) {
    const key = tenantKey(`posters/segments/${segmentId}.jpg`);
    const dest = path.join(segmentPostersDir, `${segmentId}.jpg`);
    try {
      const meta = await downloadR2File(key, dest);
      results.push({ segmentId, ok: true, bytes: meta.size });
      console.log(JSON.stringify({ segmentId, key, dest, size: meta.size }, null, 0));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      results.push({ segmentId, ok: false, error: msg });
      console.error(JSON.stringify({ segmentId, key, error: msg }, null, 0));
    }
  }

  const failed = results.filter((r) => !r.ok);
  if (failed.length > 0) {
    process.exit(1);
  }
}

void main();
