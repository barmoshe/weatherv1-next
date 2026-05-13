/**
 * One-off CLI: compares local runtime jobs.json mirror intent with R2 object
 * tenants/<tenant>/jobs/jobs.json. Loads .env.local when present (no dotenv dep).
 *
 * Usage: ./node_modules/.bin/vite-node --config vitest.config.ts scripts/check-r2-jobs-json.ts
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
import { headR2Object, tenantKey, getR2Text, r2Configured } from "@/server/sync/r2/client";

async function main(): Promise<void> {
  resetRuntimeConfigForTests();
  const localPath = path.join(getRuntimePaths().runtimeDir, "jobs.json");

  console.log(
    JSON.stringify(
      {
        localJobsPath: localPath,
        localExists: fs.existsSync(localPath),
        localBytes: fs.existsSync(localPath) ? fs.statSync(localPath).size : 0,
      },
      null,
      2,
    ),
  );

  if (!r2Configured()) {
    console.log(
      JSON.stringify(
        {
          r2Configured: false,
          hint: "Set R2_SYNC_ENABLED=1 plus gateway URL, tenant ID, Basic Auth user/password (.env.local or Electron settings). Mirror runs only after save() when r2Configured.",
        },
        null,
        2,
      ),
    );
    return;
  }

  const cfg = getRuntimeConfig().r2;
  const key = tenantKey("jobs/jobs.json");
  const head = await headR2Object(key);

  console.log(
    JSON.stringify(
      {
        r2Configured: true,
        tenantId: cfg.tenantId,
        objectKey: key,
        remoteHead: head,
      },
      null,
      2,
    ),
  );

  if (!head) {
    console.log(
      JSON.stringify({ remoteParsed: null, note: "No object at key yet (mirror never succeeded or bucket empty)." }),
    );
    return;
  }

  const { text } = await getR2Text(key);
  const parsed = JSON.parse(text) as Record<string, unknown>;
  console.log(JSON.stringify({
    remoteTopLevelEntries: Object.keys(parsed).length,
    sampleIds: Object.keys(parsed).slice(0, 5),
  }));

  try {
    const localText = fs.readFileSync(localPath, "utf8");
    const localParsed = JSON.parse(localText) as Record<string, unknown>;
    const match =
      JSON.stringify(Object.keys(parsed).sort()) ===
      JSON.stringify(Object.keys(localParsed).sort()) &&
      text.replace(/\s+/g, "") === localText.replace(/\s+/g, "");
    console.log(JSON.stringify({ localVsRemoteNormalizedMatch: match }));
  } catch {
    console.log(JSON.stringify({ localVsRemoteNormalizedMatch: false, reason: "Could not compare local parse" }));
  }
}

await main();
