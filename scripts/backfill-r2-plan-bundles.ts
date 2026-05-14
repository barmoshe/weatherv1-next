/**
 * One-off: upload local outputs/forecast_*.plan.json to R2 as
 * tenants/<tenant>/jobs/<jobId>/plan.json (same keys as live mirroring).
 * Run on a machine that still has plan files so another install can hydrate restores.
 *
 * Loads `.env.local` when present (no dotenv dep).
 *
 * Usage: ./node_modules/.bin/vite-node --config vitest.config.ts scripts/backfill-r2-plan-bundles.ts
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

import { getRuntimeConfig, resetRuntimeConfigForTests } from "@/server/runtime/config";
import { getRuntimePaths } from "@/server/runtime/paths";
import { putR2Text, r2Configured, tenantKey } from "@/server/sync/r2/client";

const PLAN_RE = /^forecast_(.+)\.plan\.json$/;

async function main(): Promise<void> {
  resetRuntimeConfigForTests();
  if (!r2Configured()) {
    console.error(
      JSON.stringify({
        error: "r2_not_configured",
        hint: "Set R2_SYNC_ENABLED=1 plus gateway, tenant, Basic Auth user/password (see scripts/check-r2-jobs-json.ts).",
      }),
    );
    process.exit(1);
  }

  const { outputsDir } = getRuntimePaths();
  if (!fs.existsSync(outputsDir)) {
    console.log(JSON.stringify({ outputsDir, uploaded: 0, skipped: 0, note: "outputs dir missing" }));
    return;
  }

  const names = fs.readdirSync(outputsDir).filter((n) => PLAN_RE.test(n));
  let uploaded = 0;
  let skipped = 0;

  for (const name of names) {
    const m = name.match(PLAN_RE);
    if (!m) continue;
    const jobId = m[1];
    const full = path.join(outputsDir, name);
    let raw: string;
    try {
      raw = fs.readFileSync(full, "utf8");
    } catch {
      skipped++;
      continue;
    }
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      skipped++;
      continue;
    }
    if (parsed.job_id !== jobId) {
      console.warn(JSON.stringify({ warn: "job_id_mismatch", file: name, job_id_field: parsed.job_id }));
      skipped++;
      continue;
    }

    const key = tenantKey(`jobs/${jobId}/plan.json`);
    await putR2Text(key, JSON.stringify(parsed, null, 2));
    uploaded++;
  }

  console.log(
    JSON.stringify({
      tenantId: getRuntimeConfig().r2.tenantId,
      outputsDir,
      scanned: names.length,
      uploaded,
      skipped,
    }),
  );
}

await main();
