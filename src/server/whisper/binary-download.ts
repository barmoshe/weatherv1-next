// In-app whisper.cpp binary downloader.
//
// Why this exists:
//   The macOS slot under `electron/bin/whisper/` is meant to be vendored at
//   release time, but Windows whisper.cpp builds are too volatile to bundle
//   reliably (BLAS, CUDA, plain CPU — and the asset names rotate). Instead
//   we download the official `whisper-bin-x64.zip` from a pinned upstream
//   release into the workspace cache, extract `whisper-cli.exe` (+ DLLs),
//   and the resolver picks it up via `tryWorkspaceCache()`.
//
// Pinned release: see `WHISPER_RELEASE` below — bump it when upstream ships
// a new tag we want users on. The downloader verifies the SHA-256 of the
// archive against `PLATFORM_ASSETS` and refuses to install a mismatch.

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import AdmZip from "adm-zip";
import { workspaceBinaryDir } from "./binary";

/** GitHub release tag to install. Bump on release-engineering pass. */
const WHISPER_RELEASE = "v1.8.4";
const WHISPER_REPO = "ggml-org/whisper.cpp";

interface PlatformAsset {
  /** `<platform>-<arch>` token, e.g. `win32-x64`. */
  key: string;
  /** Asset filename inside the release. */
  assetName: string;
  /** SHA-256 of the archive, pinned per release. */
  sha256: string;
  /** Name of the binary we expose to the resolver. */
  binaryName: string;
  /** Approx archive size for the UX (bytes). */
  sizeBytes: number;
}

// v1.8.4 — verified against
// https://github.com/ggml-org/whisper.cpp/releases/tag/v1.8.4
const PLATFORM_ASSETS: PlatformAsset[] = [
  {
    key: "win32-x64",
    assetName: "whisper-bin-x64.zip",
    sha256: "74f973345cb52ef5ba3ec9e7e7af8e48cc8c71722d1528603b80588a11f82e3e",
    binaryName: "whisper-cli.exe",
    sizeBytes: 4_078_768,
  },
  {
    key: "win32-ia32",
    assetName: "whisper-bin-Win32.zip",
    sha256: "892596da56c8762bd8a7592d5f42569943985cbd9c7fbad11c679f783f119bab",
    binaryName: "whisper-cli.exe",
    sizeBytes: 3_661_871,
  },
];

export interface WhisperBinaryDownloadProgress {
  platform: string;
  bytesDownloaded: number;
  bytesTotal: number;
  done: boolean;
  error?: string;
}

export type WhisperBinaryProgressListener = (
  p: WhisperBinaryDownloadProgress,
) => void;

export interface WhisperBinaryDownloadInfo {
  /** `<platform>-<arch>` token for the current process, e.g. `win32-x64`. */
  platform: string;
  /** Whether the current platform has a downloadable asset in this build. */
  supported: boolean;
  /** Asset filename (only set when supported). */
  asset?: string;
  /** Release tag we'll fetch. */
  release: string;
  /** Approx download size in bytes (only set when supported). */
  sizeBytes?: number;
}

export function describeBinaryDownload(): WhisperBinaryDownloadInfo {
  const platform = `${process.platform}-${process.arch}`;
  const asset = PLATFORM_ASSETS.find((p) => p.key === platform);
  return {
    platform,
    supported: Boolean(asset),
    asset: asset?.assetName,
    release: WHISPER_RELEASE,
    sizeBytes: asset?.sizeBytes,
  };
}

/**
 * Download + install the whisper.cpp binary for the current platform.
 * Streams progress events as bytes arrive over the network; extraction is
 * reported as a single final `done: true` event after the zip is unpacked.
 */
export async function downloadWhisperBinary(
  onProgress?: WhisperBinaryProgressListener,
): Promise<{ binaryPath: string }> {
  const platform = `${process.platform}-${process.arch}`;
  const asset = PLATFORM_ASSETS.find((p) => p.key === platform);
  if (!asset) {
    throw new Error(
      `No prebuilt whisper.cpp asset is available for ${platform}. ` +
        `Install via package manager (e.g. \`brew install whisper-cpp\`) ` +
        `and set WHISPER_CLI_PATH if needed.`,
    );
  }

  const targetDir = workspaceBinaryDir();
  await fsp.mkdir(targetDir, { recursive: true });

  const url = `https://github.com/${WHISPER_REPO}/releases/download/${WHISPER_RELEASE}/${asset.assetName}`;
  const zipPath = path.join(targetDir, `${asset.assetName}.part`);

  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok || !res.body) {
    throw new Error(`Failed to download ${asset.assetName}: HTTP ${res.status}`);
  }
  const totalHeader = res.headers.get("content-length");
  const bytesTotal = totalHeader ? parseInt(totalHeader, 10) : asset.sizeBytes;

  let bytesDownloaded = 0;
  const hash = crypto.createHash("sha256");
  const writeStream = fs.createWriteStream(zipPath);
  const reader = res.body.getReader();
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value) continue;
      hash.update(value);
      bytesDownloaded += value.byteLength;
      await new Promise<void>((resolve, reject) => {
        writeStream.write(value, (err) => (err ? reject(err) : resolve()));
      });
      onProgress?.({
        platform,
        bytesDownloaded,
        bytesTotal,
        done: false,
      });
    }
  } finally {
    await new Promise<void>((resolve) => writeStream.end(resolve));
  }

  const actualSha = hash.digest("hex");
  if (actualSha !== asset.sha256) {
    await fsp.unlink(zipPath).catch(() => undefined);
    throw new Error(
      `SHA mismatch for ${asset.assetName}: expected ${asset.sha256}, got ${actualSha}.`,
    );
  }

  // Extract: whisper.cpp Windows zips contain `whisper-cli.exe` plus
  // accompanying DLLs at the archive root. Scan for the binary so we
  // don't depend on a hard-coded internal path that might shift between
  // releases.
  const zip = new AdmZip(zipPath);
  const entries = zip.getEntries();
  const binaryEntry = entries.find(
    (e) => !e.isDirectory && path.basename(e.entryName).toLowerCase() === asset.binaryName.toLowerCase(),
  );
  if (!binaryEntry) {
    await fsp.unlink(zipPath).catch(() => undefined);
    throw new Error(
      `Archive ${asset.assetName} did not contain ${asset.binaryName}. ` +
        `whisper.cpp release layout may have changed.`,
    );
  }

  // Strip directory prefixes so DLLs end up next to the executable.
  const binaryDirInArchive = path.posix.dirname(binaryEntry.entryName);
  for (const entry of entries) {
    if (entry.isDirectory) continue;
    const entryDir = path.posix.dirname(entry.entryName);
    // Only extract files that live in the same dir as the binary (or root).
    if (entryDir !== binaryDirInArchive) continue;
    const flatName = path.basename(entry.entryName);
    const outPath = path.join(targetDir, flatName);
    await fsp.writeFile(outPath, entry.getData());
    if (process.platform !== "win32") {
      // Belt-and-suspenders for future cross-platform releases — Windows
      // doesn't care about the exec bit.
      try {
        await fsp.chmod(outPath, 0o755);
      } catch {
        // best-effort
      }
    }
  }

  await fsp.unlink(zipPath).catch(() => undefined);

  const binaryPath = path.join(targetDir, asset.binaryName);
  if (!fs.existsSync(binaryPath)) {
    throw new Error(`whisper-cli binary missing after extraction at ${binaryPath}`);
  }

  onProgress?.({
    platform,
    bytesDownloaded,
    bytesTotal,
    done: true,
  });

  return { binaryPath };
}

/**
 * Remove a previously-downloaded binary (and its sibling DLLs). Idempotent —
 * if the directory doesn't exist, it's a no-op.
 */
export async function removeWhisperBinary(): Promise<void> {
  const targetDir = workspaceBinaryDir();
  await fsp.rm(targetDir, { recursive: true, force: true });
}
