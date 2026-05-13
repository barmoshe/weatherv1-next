import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { parseCatalog, buildVideoMap } from "@/server/catalog/parser";
import { getVideosDir } from "@/server/catalog/storage";
import { generateSegmentPoster } from "@/server/ffmpeg/segment-posters";
import { posterPath } from "@/server/ffmpeg/posters";
import { getRuntimePaths } from "@/server/runtime/paths";
import { downloadR2File, r2Configured, tenantKey } from "@/server/sync/r2/client";

function segmentPosterKey(segId: string): string {
  return tenantKey(`posters/segments/${segId}.jpg`);
}

function clipPosterKey(videoId: string): string {
  return tenantKey(`posters/clips/${videoId}.jpg`);
}

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
    if (fs.existsSync(cachedSeg)) {
      const buf = fs.readFileSync(cachedSeg);
      return new NextResponse(buf, {
        headers: {
          "Content-Type": "image/jpeg",
          "Cache-Control": "public, max-age=3600",
          "X-Poster-Source": "local-cache",
        },
      });
    }
    if (clip && (clip.segments?.length ?? 0) <= 1) {
      const cachedClip = posterPath(clipId, postersDir);
      if (fs.existsSync(cachedClip)) {
        const buf = fs.readFileSync(cachedClip);
        return new NextResponse(buf, {
          headers: {
            "Content-Type": "image/jpeg",
            "Cache-Control": "public, max-age=3600",
            "X-Poster-Source": "local-cache",
          },
        });
      }
    }
  }

  // R2-first browse path: fetch poster objects only, never source video.
  if (r2Configured()) {
    try {
      await downloadR2File(segmentPosterKey(segId), cachedSeg);
      if (fs.existsSync(cachedSeg)) {
        const buf = fs.readFileSync(cachedSeg);
        return new NextResponse(buf, {
          headers: {
            "Content-Type": "image/jpeg",
            "Cache-Control": "public, max-age=3600",
            "X-Poster-Source": "r2-cache",
          },
        });
      }
    } catch {
      // Many single-segment clips only have a clip-level poster.
    }

    try {
      const cachedClip = posterPath(clipId, postersDir);
      await downloadR2File(clipPosterKey(clipId), cachedClip);
      if (fs.existsSync(cachedClip)) {
        const buf = fs.readFileSync(cachedClip);
        return new NextResponse(buf, {
          headers: {
            "Content-Type": "image/jpeg",
            "Cache-Control": "public, max-age=3600",
            "X-Poster-Source": "r2-cache",
          },
        });
      }
    } catch (err) {
      console.warn(`segment-poster: R2 poster fetch failed for ${segId}:`, err);
    }
  }

  // Explicit force=1 local regeneration remains available for maintenance.
  if (force && clip && clip.availability === "local") {
    const posterFilePath = await generateSegmentPoster(segId, videoMap, force);
    if (posterFilePath && fs.existsSync(posterFilePath)) {
      const buf = fs.readFileSync(posterFilePath);
      return new NextResponse(buf, {
        headers: {
          "Content-Type": "image/jpeg",
          "Cache-Control": "public, max-age=3600",
          "X-Poster-Source": "ffmpeg-local",
        },
      });
    }
  }

  return NextResponse.json({ success: false, error: "Poster not available" }, { status: 404 });
}
