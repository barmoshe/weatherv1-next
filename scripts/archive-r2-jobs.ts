/**
 * One-off CLI: archive every R2-side job (plan bundles + voiceovers) to a
 * local directory under `runtime/archive/`, optionally deleting them from
 * R2 afterwards. Defaults to a non-destructive DRY RUN.
 *
 * What it touches:
 *   tenants/<tid>/jobs/<jobId>/plan.json       — downloaded, then (in --delete) removed
 *   tenants/<tid>/voiceovers/<jobId>/<file>    — downloaded, then (in --delete) removed
 *   tenants/<tid>/jobs/jobs.json               — archived, then (in --delete) overwritten with {}
 *
 * What it intentionally does NOT touch:
 *   catalog / videos / posters — those are shared media, not per-job.
 *   runtime/outputs/ (renders) — they live only on disk; not in R2 by design.
 *
 * Ad-hoc R2 admin (list / inspect / hand-edit individual keys): prefer
 * `wrangler r2 object {get,put,delete} weatherv1-media/<key> --remote`
 * once you're logged into the WeatherV1 Cloudflare account
 * (`wrangler login` → pick the account that owns `barprojectsandbuilds.workers.dev`).
 * This script is for full-tenant sweeps; wrangler is for surgical edits.
 *
 * Usage:
 *   # Dry run (default) — writes manifest, downloads nothing
 *   ./node_modules/.bin/vite-node --config vitest.config.ts scripts/archive-r2-jobs.ts
 *
 *   # Dry run + actually fetch the bytes into runtime/archive/
 *   ./node_modules/.bin/vite-node --config vitest.config.ts scripts/archive-r2-jobs.ts --download
 *
 *   # Destructive: delete from R2 after archiving (requires --download to have happened)
 *   ./node_modules/.bin/vite-node --config vitest.config.ts scripts/archive-r2-jobs.ts --download --delete
 *
 * Env (loaded from .env.local when present, otherwise expected in shell):
 *   R2_SYNC_ENABLED=1
 *   R2_GATEWAY_URL=https://…
 *   R2_TENANT_ID=…
 *   R2_APP_USERNAME=v1editor
 *   EDITOR_PASSWORD=<unified editor + R2 Basic-auth password>
 */

import fs from "node:fs";
import path from "node:path";
import { loadDotenvFiles } from "./_lib/load-env";

const repoRoot = process.cwd();
loadDotenvFiles(repoRoot);

// Hardcoded production gateway/tenant/bucket fall-backs, mirroring
// electron/config.cjs's PRODUCTION_R2 so the script Just Works on a
// machine where only the editor password is in env (typical dev box).
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
  deleteR2Object,
  getR2Text,
  headR2Object,
  putR2Text,
  downloadR2File,
  tenantKey,
  r2Configured,
} from "@/server/sync/r2/client";

interface JobRecord {
  job_id?: string;
  status?: string;
  audio_filename?: string;
  created_at?: string;
}

interface ManifestEntry {
  jobId: string;
  status?: string;
  createdAt?: string;
  planKey: string;
  planSize?: number;
  planMissing?: boolean;
  voiceoverKey?: string;
  voiceoverSize?: number;
  voiceoverMissing?: boolean;
  audioFilename?: string;
}

const args = new Set(process.argv.slice(2));
const DOWNLOAD = args.has("--download");
const DELETE = args.has("--delete");

if (DELETE && !DOWNLOAD) {
  console.error("Refusing --delete without --download. Archive the bytes first.");
  process.exit(2);
}

if (!r2Configured()) {
  console.error("R2 is not configured. Need R2_SYNC_ENABLED=1 + gateway URL + tenant + user + password.");
  process.exit(2);
}

const STAMP = new Date().toISOString().slice(0, 10);
const ARCHIVE_DIR = path.join(repoRoot, "runtime", "archive", `r2-jobs-${STAMP}`);
fs.mkdirSync(ARCHIVE_DIR, { recursive: true });

async function main(): Promise<void> {
  console.log(`Mode: ${DELETE ? "ARCHIVE + DELETE" : DOWNLOAD ? "ARCHIVE (no delete)" : "DRY RUN (no fetch, no delete)"}`);
  console.log(`Tenant: ${process.env.R2_TENANT_ID} | Gateway: ${process.env.R2_GATEWAY_URL}`);
  console.log(`Archive dir: ${path.relative(repoRoot, ARCHIVE_DIR)}\n`);

  const jobsJsonKey = tenantKey("jobs/jobs.json");
  console.log(`Reading ${jobsJsonKey}…`);
  const { text: jobsJsonText } = await getR2Text(jobsJsonKey);
  let jobsMap: Record<string, JobRecord> = {};
  try {
    jobsMap = JSON.parse(jobsJsonText) as Record<string, JobRecord>;
  } catch (e) {
    console.error(`Failed to parse jobs.json: ${e}`);
    process.exit(1);
  }
  const jobIds = Object.keys(jobsMap);
  console.log(`Found ${jobIds.length} jobs in jobs.json\n`);

  if (DOWNLOAD) {
    fs.writeFileSync(path.join(ARCHIVE_DIR, "jobs.json"), jobsJsonText);
  }

  const manifest: ManifestEntry[] = [];
  let totalBytes = 0;

  for (const jobId of jobIds) {
    const job = jobsMap[jobId] ?? {};
    const planKey = tenantKey(`jobs/${jobId}/plan.json`);
    const entry: ManifestEntry = {
      jobId,
      status: job.status,
      createdAt: job.created_at,
      planKey,
    };

    // Plan bundle
    const planHead = await headR2Object(planKey);
    if (!planHead) {
      entry.planMissing = true;
    } else {
      entry.planSize = planHead.size;
      totalBytes += planHead.size ?? 0;
    }

    // Voiceover — need plan.json to know the audio filename
    let audioFilename = job.audio_filename;
    if (!audioFilename && planHead) {
      try {
        const { text } = await getR2Text(planKey);
        const plan = JSON.parse(text) as { audio_filename?: string };
        audioFilename = plan.audio_filename;
      } catch {
        /* tolerated */
      }
    }
    if (audioFilename) {
      entry.audioFilename = audioFilename;
      const voKey = tenantKey(`voiceovers/${jobId}/${audioFilename}`);
      entry.voiceoverKey = voKey;
      const voHead = await headR2Object(voKey);
      if (!voHead) entry.voiceoverMissing = true;
      else {
        entry.voiceoverSize = voHead.size;
        totalBytes += voHead.size ?? 0;
      }
    }

    // Download phase
    if (DOWNLOAD) {
      const jobDir = path.join(ARCHIVE_DIR, jobId);
      fs.mkdirSync(jobDir, { recursive: true });
      if (!entry.planMissing) {
        await downloadR2File(planKey, path.join(jobDir, "plan.json"));
      }
      if (entry.voiceoverKey && !entry.voiceoverMissing) {
        await downloadR2File(entry.voiceoverKey, path.join(jobDir, audioFilename!));
      }
    }

    manifest.push(entry);
    process.stdout.write(
      `  ${jobId.slice(0, 8)}  status=${entry.status ?? "?"}  plan=${entry.planMissing ? "MISSING" : (entry.planSize ?? 0) + "B"}  vo=${entry.voiceoverMissing ? "MISSING" : entry.audioFilename ? (entry.voiceoverSize ?? 0) + "B" : "n/a"}\n`,
    );
  }

  const manifestPath = path.join(ARCHIVE_DIR, "manifest.json");
  fs.writeFileSync(
    manifestPath,
    JSON.stringify({ tenantId: process.env.R2_TENANT_ID, generatedAt: new Date().toISOString(), jobCount: jobIds.length, totalBytes, entries: manifest }, null, 2),
  );

  console.log(`\nSummary: ${jobIds.length} jobs, ~${(totalBytes / 1024 / 1024).toFixed(2)} MiB on R2`);
  console.log(`Manifest: ${path.relative(repoRoot, manifestPath)}`);

  if (!DOWNLOAD) {
    console.log("\nDry run only. Re-run with --download to fetch bytes into the archive dir.");
    return;
  }

  if (!DELETE) {
    console.log("\nArchive complete. Re-run with --download --delete to remove from R2.");
    return;
  }

  // Delete phase
  console.log("\nDeleting from R2…");
  for (const e of manifest) {
    if (!e.planMissing) {
      await deleteR2Object(e.planKey);
      console.log(`  DELETE ${e.planKey}`);
    }
    if (e.voiceoverKey && !e.voiceoverMissing) {
      await deleteR2Object(e.voiceoverKey);
      console.log(`  DELETE ${e.voiceoverKey}`);
    }
  }
  // Truncate jobs.json to an empty map last, so partial failures above don't
  // leave dangling entries that point to deleted objects.
  await putR2Text(jobsJsonKey, "{}");
  console.log(`  PUT    ${jobsJsonKey} (truncated to {})`);
  console.log("\nDone.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
