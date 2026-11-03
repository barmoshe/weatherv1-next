// Browser build: no pre-cut pass. The Electron renderer cut each pick to its
// own file first (ffmpeg seek accuracy); the browser renderer decodes the
// exact frames it needs from the library file, so picks pass through.
import fs from "node:fs";
import type { ParsedVideo, ResolvedPick } from "@/shared/types";

export interface RenderReadyMedia {
  filePath: string;
  duration: number;
  segmentId: string;
  videoId: string;
}

export interface PreparedRenderMedia {
  timeline: ResolvedPick[];
  videoMap: Record<string, ParsedVideo>;
  media: RenderReadyMedia[];
  tempDir: string;
  cleanup: () => Promise<void>;
}

export async function prepareRenderMedia(
  timeline: ResolvedPick[],
  videoMap: Record<string, ParsedVideo>,
): Promise<PreparedRenderMedia> {
  for (const pick of timeline) {
    const video = videoMap[pick.video_id];
    if (!video) throw new Error(`Clip ${pick.video_id} was picked but is missing from the catalog`);
    if (!video.path || !fs.existsSync(video.path)) {
      throw new Error(`Clip ${pick.video_id} is not in the library's videos folder (${video.filename})`);
    }
  }
  return { timeline, videoMap, media: [], tempDir: "", cleanup: async () => undefined };
}
