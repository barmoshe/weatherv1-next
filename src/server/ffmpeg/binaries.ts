import { execFileSync } from "node:child_process";
import { getRuntimeConfig } from "@/server/runtime/config";

let _ffmpegPath: string | null = null;
let _ffprobePath: string | null = null;
let _verified = false;

function resolveBinary(name: string): string {
  try {
    const out = execFileSync("which", [name], { encoding: "utf8" }).trim();
    if (out) return out;
  } catch {
    // ignore
  }
  return name; // fall back to bare name (will fail at spawn time with a clear error)
}

export function getFFmpegPath(): string {
  if (!_ffmpegPath) _ffmpegPath = getRuntimeConfig().ffmpegPath || resolveBinary("ffmpeg");
  return _ffmpegPath;
}

export function getFFprobePath(): string {
  if (!_ffprobePath) _ffprobePath = getRuntimeConfig().ffprobePath || resolveBinary("ffprobe");
  return _ffprobePath;
}

export function verifyFFmpegAtBoot(): void {
  if (_verified) return;
  try {
    execFileSync(getFFmpegPath(), ["-version"], { stdio: "pipe" });
    execFileSync(getFFprobePath(), ["-version"], { stdio: "pipe" });
    _verified = true;
  } catch (err) {
    throw new Error(
      `ffmpeg/ffprobe not found or not executable. Install ffmpeg or configure explicit paths. ` +
        `Underlying error: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}
