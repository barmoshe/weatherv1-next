/**
 * Resolves all media for a self-contained Premiere export bundle.
 *
 * For each planned clip it ensures a FULL local original (using the local copy
 * when present, else downloading the R2 object), then ffmpeg-extracts just that
 * clip's cut PLUS a one-second handle on each side. The trimmed segment — not
 * the whole source — is what lands in the bundle, so the zip stays small while
 * the editor keeps a second of slack to nudge either edge. The XML in/out are
 * rebased onto the trimmed file's clock. The voiceover and the default
 * background-music asset are bundled as-is.
 */

import fs from "node:fs";
import path from "node:path";
import { downloadR2File } from "@/server/sync/r2/client";
import { getRuntimePaths, safeId } from "@/server/runtime/paths";
import { probeVideo } from "@/server/ffmpeg/probe";
import { getFFmpegPath } from "@/server/ffmpeg/binaries";
import { spawnFFmpeg } from "@/server/ffmpeg/spawn";
import { getAssetSource } from "@/server/assets/source";
import { hydrateVoiceoverFromR2 } from "@/server/sync/r2/hydrate-voiceover";
import { clipTrimWindow } from "@/server/ffmpeg/timeline-clip-timing";
import {
  VERTICAL_FRAME_HEIGHT,
  VERTICAL_FRAME_WIDTH,
  VERTICAL_SCALE_CROP_FILTER,
} from "@/server/ffmpeg/vertical-frame";
import type { ParsedVideo, ResolvedPick } from "@/shared/types";
import type { Fcp7AudioSource, Fcp7ClipPlacement } from "./fcp7-xml";

/** Seconds of extra footage kept on each side of a clip's planned cut. */
const HANDLE_SEC = 1;

export interface ExportMediaFile {
  localPath: string;
  zipName: string;
}

export interface PreparedExportMedia {
  clips: Fcp7ClipPlacement[];
  voiceover: Fcp7AudioSource | null;
  bgMusic: Fcp7AudioSource | null;
  files: ExportMediaFile[];
  cleanup: () => Promise<void>;
}

async function ensureOriginalLocal(pv: ParsedVideo, sourcesDir: string): Promise<string> {
  if (pv.availability === "local" && fs.existsSync(pv.path)) return pv.path;
  const remoteKey = pv.remote?.key;
  if (!remoteKey) {
    throw new Error(`Clip ${pv.id} is not available locally and has no R2 object to download`);
  }
  await fs.promises.mkdir(sourcesDir, { recursive: true });
  const ext = path.extname(pv.filename || "") || ".mp4";
  const dest = path.join(sourcesDir, `${safeId(pv.id)}${ext}`);
  await downloadR2File(remoteKey, dest);
  return dest;
}

/**
 * Pure argv builder for `extractSegment` — split out so it's testable without
 * spawning ffmpeg. `-ss` before `-i` seeks fast and (because we re-encode)
 * lands on the exact frame with output timestamps reset to 0. The `-vf` chain
 * is the shared 9:16 cover-crop the renderer uses, so bundled Premiere clips
 * are frame-identical to the rendered MP4 (fix 2026-05-29 — previously the
 * export skipped scale/crop and clips imported as a small letterboxed band).
 * Audio is dropped: the timeline's audio comes from the voiceover + bg-music
 * tracks, mirroring the renderer. Codec matches the renderer (libx264 /
 * yuv420p) so Premiere imports cleanly.
 */
export function buildExtractSegmentArgs(
  input: string,
  out: string,
  startSec: number,
  durSec: number,
): string[] {
  return [
    "-ss", startSec.toFixed(3),
    "-i", input,
    "-t", durSec.toFixed(3),
    "-an",
    "-vf", VERTICAL_SCALE_CROP_FILTER,
    "-vcodec", "libx264",
    "-preset", "veryfast",
    "-pix_fmt", "yuv420p",
    "-y", out,
  ];
}

async function extractSegment(input: string, out: string, startSec: number, durSec: number): Promise<void> {
  const { code, stderrTail } = await spawnFFmpeg(
    getFFmpegPath(),
    buildExtractSegmentArgs(input, out, startSec, durSec),
    { timeoutMs: 120_000 },
  );
  if (code !== 0) {
    throw new Error(`ffmpeg trim failed for ${path.basename(input)}:\n${stderrTail}`);
  }
}

export async function prepareExportMedia(args: {
  jobId: string;
  timeline: ResolvedPick[];
  durationSec: number;
  videoMap: Record<string, ParsedVideo>;
  audioFilename: string;
}): Promise<PreparedExportMedia> {
  const { jobId, timeline, durationSec, videoMap, audioFilename } = args;
  const { uploadsDir, renderTmpDir } = getRuntimePaths();
  const tempDir = path.join(renderTmpDir, `export-${safeId(jobId)}`);
  const sourcesDir = path.join(tempDir, "sources");
  const clipsDir = path.join(tempDir, "clips");

  const files: ExportMediaFile[] = [];
  const cleanup = async () => {
    await fs.promises.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  };

  try {
    // Materialize + probe each unique source concurrently — R2 downloads
    // dominate wall time and are independent. We probe the original once for
    // dimensions + full duration, then trim per pick below.
    interface SourceMeta {
      localPath: string;
      width: number;
      height: number;
      durationSec: number;
    }
    const uniqueIds = [...new Set(timeline.map((p) => p.video_id))];
    const sourceById = new Map<string, SourceMeta>();
    await Promise.all(
      uniqueIds.map(async (id) => {
        const pv = videoMap[id];
        if (!pv) throw new Error(`Clip ${id} was planned but is missing from the catalog`);
        const localPath = await ensureOriginalLocal(pv, sourcesDir);
        const probe = await probeVideo(localPath);
        sourceById.set(id, {
          localPath,
          width: probe.width,
          height: probe.height,
          durationSec: probe.durationSec,
        });
      }),
    );

    await fs.promises.mkdir(clipsDir, { recursive: true });

    // Trim one segment per timeline pick (sequential — re-encodes are
    // CPU-bound; running them back-to-back keeps the box responsive).
    const clips: Fcp7ClipPlacement[] = [];
    for (let i = 0; i < timeline.length; i++) {
      const pick = timeline[i];
      const src = sourceById.get(pick.video_id)!;
      const win = clipTrimWindow(pick, src.durationSec, HANDLE_SEC);

      const name = `clip_${String(i).padStart(2, "0")}_${safeId(pick.video_id)}.mp4`;
      const localPath = path.join(clipsDir, name);
      await extractSegment(src.localPath, localPath, win.trimStartSec, win.fileDurationSec);
      files.push({ localPath, zipName: `media/${name}` });

      // Bundled file is cover-cropped to the shared 9:16 frame, so FCP7 reports
      // the actual on-disk dims, not the source's. Without this, a landscape
      // 1920×1080 source leaked into the XML and Premiere dropped it into a
      // 1080×1920 sequence with no motion transform → small letterboxed band.
      clips.push({
        fileId: `file-clip-${i}`,
        name,
        pathUrl: `media/${name}`,
        width: VERTICAL_FRAME_WIDTH,
        height: VERTICAL_FRAME_HEIGHT,
        fileDurationSec: win.fileDurationSec,
        seqStartSec: pick.audio_start,
        seqEndSec: pick.audio_end,
        inSec: win.inSec,
        outSec: win.outSec,
        note: pick.picker_reason ?? pick.fallback_reason ?? pick.reason ?? "",
      });
    }

    // Voiceover — materialize from R2 if needed, then bundle whole.
    const voiceoverPath = path.join(uploadsDir, path.basename(audioFilename));
    await hydrateVoiceoverFromR2(jobId, audioFilename, voiceoverPath).catch(() => {});
    let voiceover: Fcp7AudioSource | null = null;
    if (audioFilename && fs.existsSync(voiceoverPath)) {
      const name = `voiceover${path.extname(audioFilename) || ".mp3"}`;
      files.push({ localPath: voiceoverPath, zipName: `media/${name}` });
      voiceover = { pathUrl: `media/${name}`, name, durationSec };
    }

    // Background music — the fixed/bundled default asset.
    let bgMusic: Fcp7AudioSource | null = null;
    const bgMusicPath = getAssetSource().getDefaultBgMusicPath();
    if (fs.existsSync(bgMusicPath)) {
      const probe = await probeVideo(bgMusicPath);
      if (probe.durationSec > 0) {
        const name = `background-music${path.extname(bgMusicPath) || ".mp3"}`;
        files.push({ localPath: bgMusicPath, zipName: `media/${name}` });
        bgMusic = { pathUrl: `media/${name}`, name, durationSec: probe.durationSec };
      }
    }

    return { clips, voiceover, bgMusic, files, cleanup };
  } catch (err) {
    await cleanup();
    throw err;
  }
}
