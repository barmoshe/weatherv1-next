import fs from "node:fs";
import path from "node:path";
import { downloadR2File, r2Configured, tenantKey } from "@/server/sync/r2/client";

function isR2NotFound(err: unknown): boolean {
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
  return (
    e?.name === "NoSuchKey" ||
    e?.name === "NotFound" ||
    e?.$metadata?.httpStatusCode === 404
  );
}

/**
 * When R2 is configured and the local uploads cache is empty, download the
 * voiceover from `voiceovers/<jobId>/<basename>` (mirrors transcribe upload key).
 * Skips download if local file exists and is non-empty (immutable per job + filename).
 */
export async function hydrateVoiceoverFromR2(
  jobId: string,
  audioBasename: string,
  localPath: string,
): Promise<void> {
  if (!r2Configured()) return;

  const basename = path.basename(audioBasename);
  try {
    const st = fs.statSync(localPath);
    if (st.size > 0) return;
  } catch {
    // missing — hydrate
  }

  const relativeKey = `voiceovers/${jobId}/${basename}`;
  const key = tenantKey(relativeKey);
  try {
    await downloadR2File(key, localPath);
    console.info(`[r2] hydrated voiceover for job ${jobId} from ${relativeKey}`);
  } catch (err) {
    if (isR2NotFound(err)) {
      throw new Error(`Voiceover missing in cloud (R2 404) for job ${jobId} key ${relativeKey}`);
    }
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Voiceover download failed for job ${jobId}: ${msg}`);
  }
}
