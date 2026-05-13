import path from "node:path";
import { getRuntimeConfig } from "./config";

export interface RuntimePaths {
  runtimeDir: string;
  uploadsDir: string;
  outputsDir: string;
  cacheDir: string;
  tmpDir: string;
  renderTmpDir: string;
  postersDir: string;
  previewsDir: string;
  segmentPostersDir: string;
}

export function getRuntimePaths(): RuntimePaths {
  const { runtimeDir } = getRuntimeConfig();
  const cacheDir = path.join(runtimeDir, "cache");
  const tmpDir = path.join(runtimeDir, "tmp");

  return {
    runtimeDir,
    uploadsDir: path.join(runtimeDir, "uploads"),
    outputsDir: path.join(runtimeDir, "outputs"),
    cacheDir,
    tmpDir,
    renderTmpDir: path.join(tmpDir, "renders"),
    postersDir: path.join(cacheDir, "posters"),
    previewsDir: path.join(cacheDir, "previews"),
    segmentPostersDir: path.join(cacheDir, "segment_posters"),
  };
}
