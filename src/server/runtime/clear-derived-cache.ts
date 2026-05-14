import fs from "node:fs/promises";
import path from "node:path";
import { getRuntimePaths } from "./paths";

export interface ClearDerivedCacheResult {
  cleared_paths: string[];
}

/**
 * Deletes derived media under runtime/cache and tmp/renders, then recreates empty dirs.
 * Does not touch uploads, outputs, workspace videos, or catalog.
 */
export async function clearDerivedRuntimeCaches(): Promise<ClearDerivedCacheResult> {
  const p = getRuntimePaths();
  const taggingDir = path.join(p.cacheDir, "tagging");
  const dirs = [
    p.postersDir,
    p.previewsDir,
    p.segmentPostersDir,
    p.renderTmpDir,
    taggingDir,
  ];

  for (const dir of dirs) {
    await fs.rm(dir, { recursive: true, force: true });
    await fs.mkdir(dir, { recursive: true });
  }

  return { cleared_paths: dirs };
}
