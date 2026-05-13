import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { parseCatalog, buildVideoMap } from "@/server/catalog/parser";
import { getVideosDir } from "@/server/catalog/storage";
import { generateSegmentPoster } from "@/server/ffmpeg/segment-posters";
import { posterPath } from "@/server/ffmpeg/posters";
import { getRuntimePaths } from "@/server/runtime/paths";
import { getR2Stream, r2Configured, tenantKey } from "@/server/sync/r2/client";

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

  // Local cache fast path: per-segment, then per-clip fallback.
  if (!force) {
    const cachedSeg = path.join(segmentPostersDir, `${segId}.jpg`);
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

  // Local video present: ffmpeg-generate the segment poster.
  if (clip && clip.availability === "local") {
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
    // fall through to R2 in case a generated poster is already there
  }

  // Cloud-only / generation failed: stream from R2.
  if (r2Configured()) {
    try {
      // Try the segment poster first; fall back to clip poster (single-segment clips
      // are often only stored under posters/clips/<id>.jpg).
      let stream = await getR2Stream(segmentPosterKey(segId));
      if (!stream) stream = await getR2Stream(clipPosterKey(clipId));
      if (stream) {
        const headers: Record<string, string> = {
          "Content-Type": stream.contentType ?? "image/jpeg",
          "Cache-Control": "public, max-age=3600",
          "X-Poster-Source": "r2",
        };
        if (stream.contentLength != null) headers["Content-Length"] = String(stream.contentLength);
        if (stream.etag) headers["ETag"] = stream.etag;
        return new NextResponse(stream.body, { headers });
      }
    } catch (err) {
      console.warn(`segment-poster: R2 stream failed for ${segId}:`, err);
    }
  }

  return NextResponse.json({ success: false, error: "Poster not available" }, { status: 404 });
}
