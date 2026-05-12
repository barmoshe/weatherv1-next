import path from "node:path";
import { getRuntimeConfig } from "./config";

export interface RuntimePaths {
  runtimeDir: string;
  uploadsDir: string;
  outputsDir: string;
  cacheDir: string;
  postersDir: string;
  previewsDir: string;
  segmentPostersDir: string;
}

export function getRuntimePaths(): RuntimePaths {
  const { runtimeDir } = getRuntimeConfig();
  const cacheDir = path.join(runtimeDir, "cache");

  return {
    runtimeDir,
    uploadsDir: path.join(runtimeDir, "uploads"),
    outputsDir: path.join(runtimeDir, "outputs"),
    cacheDir,
    postersDir: path.join(cacheDir, "posters"),
    previewsDir: path.join(cacheDir, "previews"),
    segmentPostersDir: path.join(cacheDir, "segment_posters"),
  };
}
