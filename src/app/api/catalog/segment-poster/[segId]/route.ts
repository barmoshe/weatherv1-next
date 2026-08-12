import { NextRequest, NextResponse } from "next/server";
import path from "node:path";
import { parseCatalog, buildVideoMap } from "@/server/catalog/parser";
import { getVideosDir } from "@/server/catalog/storage";
import { generateSegmentPoster } from "@/server/ffmpeg/segment-posters";
import { posterPath } from "@/server/ffmpeg/posters";
import { posterResponse } from "@/server/ffmpeg/poster-response";
import { getRuntimePaths } from "@/server/runtime/paths";
import {
  clipPosterKey,
  downloadR2File,
  r2Configured,
  segmentPosterKey,
} from "@/server/sync/r2/client";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ segId: string }> }
) {
  const { segId } = await params;
  const force = req.nextUrl.searchParams.get("force") === "1";
  const { segmentPostersDir, postersDir } = getRuntimePaths();

  const videos = parseCatalog(undefined, getVideosDir());
  const videoMap = buildVideoMap(videos);
  const clipId = segId.includes("-s") ? segId.slice(0, segId.lastIndexOf("-s")) : segId;
  const clip = videoMap[clipId];
  const cachedSeg = path.join(segmentPostersDir, `${segId}.jpg`);

  // Local cache fast path: per-segment, then per-clip fallback.
  if (!force) {
    const seg = posterResponse(cachedSeg, "local-cache");
    if (seg) return seg;
    if (clip && (clip.segments?.length ?? 0) <= 1) {
      const clipPoster = posterResponse(posterPath(clipId, postersDir), "local-cache");
      if (clipPoster) return clipPoster;
    }
  }

  // Local-first: regenerate from the library file whenever it is on disk.
  // force=1 keeps working as the cache-busting maintenance path.
  if (clip && clip.availability === "local") {
    const posterFilePath = await generateSegmentPoster(segId, videoMap, force);
    if (posterFilePath) {
      const res = posterResponse(posterFilePath, "ffmpeg-local");
      if (res) return res;
    }
  }

  // Dormant R2 fallback for clips that only exist in the cloud: poster
  // objects only, never source video.
  if (r2Configured()) {
    try {
      await downloadR2File(segmentPosterKey(segId), cachedSeg);
      const seg = posterResponse(cachedSeg, "r2-cache");
      if (seg) return seg;
    } catch {
      // Many single-segment clips only have a clip-level poster.
    }

    try {
      const cachedClip = posterPath(clipId, postersDir);
      await downloadR2File(clipPosterKey(clipId), cachedClip);
      const res = posterResponse(cachedClip, "r2-cache");
      if (res) return res;
    } catch (err) {
      console.warn(`segment-poster: R2 poster fetch failed for ${segId}:`, err);
    }
  }

  return NextResponse.json({ success: false, error: "Poster not available" }, { status: 404 });
}
