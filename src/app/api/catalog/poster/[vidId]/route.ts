import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import { parseCatalog, buildVideoMap } from "@/server/catalog/parser";
import { getVideosDir } from "@/server/catalog/storage";
import { generatePoster, posterPath } from "@/server/ffmpeg/posters";
import { getRuntimePaths } from "@/server/runtime/paths";
import { getR2Stream, r2Configured, tenantKey } from "@/server/sync/r2/client";

function clipPosterKey(videoId: string): string {
  return tenantKey(`posters/clips/${videoId}.jpg`);
}

function notFound(): NextResponse {
  return NextResponse.json({ success: false, error: "Poster not available" }, { status: 404 });
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ vidId: string }> }
) {
  const { vidId } = await params;
  const force = req.nextUrl.searchParams.get("force") === "1";
  const { postersDir } = getRuntimePaths();

  const videos = parseCatalog(undefined, getVideosDir());
  const videoMap = buildVideoMap(videos);
  const video = videoMap[vidId];
  if (!video) {
    return NextResponse.json({ success: false, error: "Video not found" }, { status: 404 });
  }

  // Local cache fast path: serve cached poster regardless of availability.
  if (!force) {
    const cached = posterPath(vidId, postersDir);
    if (fs.existsSync(cached)) {
      const buf = fs.readFileSync(cached);
      return new NextResponse(buf, {
        headers: {
          "Content-Type": "image/jpeg",
          "Cache-Control": "public, max-age=3600",
          "X-Poster-Source": "local-cache",
        },
      });
    }
  }

  // Local video present: ffmpeg-generate as before.
  if (video.availability === "local") {
    const posterFilePath = await generatePoster(video.path, vidId, postersDir, force);
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
    // ffmpeg failed — fall through to R2 in case a stale R2 poster is around.
  }

  // Cloud-only or local generation failed: stream the poster from R2 if present.
  if (r2Configured()) {
    try {
      const stream = await getR2Stream(clipPosterKey(vidId));
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
      console.warn(`poster: R2 stream failed for ${vidId}:`, err);
    }
  }

  return notFound();
}
