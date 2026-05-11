import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getFFprobePath } from "./binaries";

const execFileAsync = promisify(execFile);

export interface ProbeResult {
  durationSec: number;
  width: number;
  height: number;
  orientation: "H" | "V";
  videoCodec: string;
  pixFmt: string;
  hasAudio: boolean;
  audioCodec?: string;
}

const ZERO_RESULT: ProbeResult = {
  durationSec: 0,
  width: 0,
  height: 0,
  orientation: "V",
  videoCodec: "",
  pixFmt: "",
  hasAudio: false,
};

export async function probeVideo(absPath: string): Promise<ProbeResult> {
  try {
    const { stdout } = await execFileAsync(
      getFFprobePath(),
      [
        "-v", "error",
        "-print_format", "json",
        "-show_format",
        "-show_streams",
        absPath,
      ],
      { timeout: 15_000 }
    );
    const data = JSON.parse(stdout) as {
      format?: { duration?: string };
      streams?: Array<{
        codec_type?: string;
        codec_name?: string;
        width?: number;
        height?: number;
        pix_fmt?: string;
      }>;
    };

    const durationSec = parseFloat(data.format?.duration ?? "0") || 0;
    const videoStream = data.streams?.find((s) => s.codec_type === "video");
    const audioStream = data.streams?.find((s) => s.codec_type === "audio");

    const width = videoStream?.width ?? 0;
    const height = videoStream?.height ?? 0;
    const orientation: "H" | "V" = width > height ? "H" : "V";

    return {
      durationSec,
      width,
      height,
      orientation,
      videoCodec: videoStream?.codec_name ?? "",
      pixFmt: videoStream?.pix_fmt ?? "",
      hasAudio: !!audioStream,
      audioCodec: audioStream?.codec_name,
    };
  } catch (err) {
    console.warn(`probeVideo failed for ${absPath}:`, err);
    return { ...ZERO_RESULT };
  }
}

/** Lighter variant — only duration + orientation (used by upload path) */
export async function probeDimensionsAndDuration(
  absPath: string
): Promise<{ durationSec: number; orientation: "H" | "V" }> {
  const r = await probeVideo(absPath);
  return { durationSec: r.durationSec, orientation: r.orientation };
}
