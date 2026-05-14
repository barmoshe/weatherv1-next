/**
 * One-off: upload local runtime/uploads voiceover files to R2 at
 * tenants/<tenant>/voiceovers/<jobId>/<basename> (same keys as transcribe + hydrate).
 * Does not touch outputs/**.
 *
 * Loads `.env.local` when present (no dotenv dep).
 *
 * Usage: ./node_modules/.bin/vite-node --config vitest.config.ts scripts/backfill-r2-voiceovers.ts
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
import { r2Configured, tenantKey, uploadR2File } from "@/server/sync/r2/client";

function mimeFor(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  if (ext === ".mov") return "video/quicktime";
  if (ext === ".mp4") return "video/mp4";
  if (ext === ".mp3") return "audio/mpeg";
  if (ext === ".wav") return "audio/wav";
  return "application/octet-stream";
}

interface JobShape {
  job_id?: string;
  audio_filename?: string;
}

async function main(): Promise<void> {
  resetRuntimeConfigForTests();
  if (!r2Configured()) {
    console.error(
      JSON.stringify({
        error: "r2_not_configured",
        hint: "Set R2 sync env (see scripts/check-r2-jobs-json.ts or backfill-r2-plan-bundles.ts).",
      }),
    );
    process.exit(1);
  }

  const { runtimeDir, uploadsDir } = getRuntimePaths();
  const jobsPath = path.join(runtimeDir, "jobs.json");
  if (!fs.existsSync(jobsPath)) {
    console.log(JSON.stringify({ jobsPath, uploaded: 0, skipped: 0, note: "jobs.json missing" }));
    return;
  }

  let raw: Record<string, JobShape>;
  try {
    raw = JSON.parse(fs.readFileSync(jobsPath, "utf8")) as Record<string, JobShape>;
  } catch {
    console.error(JSON.stringify({ error: "jobs_json_unreadable", jobsPath }));
    process.exit(1);
  }

  let uploaded = 0;
  let skipped = 0;
  let missingFile = 0;

  for (const [id, job] of Object.entries(raw)) {
    const jobId = job.job_id ?? id;
    const audio = job.audio_filename?.trim();
    if (!audio) {
      skipped++;
      continue;
    }
    const basename = path.basename(audio);
    const localPath = path.join(uploadsDir, basename);
    if (!fs.existsSync(localPath)) {
      missingFile++;
      skipped++;
      continue;
    }
    const st = fs.statSync(localPath);
    if (st.size <= 0) {
      skipped++;
      continue;
    }

    const relativeKey = `voiceovers/${jobId}/${basename}`;
    const key = tenantKey(relativeKey);
    await uploadR2File(key, localPath, mimeFor(localPath));
    uploaded++;
  }

  console.log(
    JSON.stringify({
      tenantId: getRuntimeConfig().r2.tenantId,
      uploadsDir,
      jobsScanned: Object.keys(raw).length,
      uploaded,
      skipped,
      missingLocalFile: missingFile,
    }),
  );
}

await main();
