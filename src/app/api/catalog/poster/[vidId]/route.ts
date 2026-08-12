import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import { parseCatalog, buildVideoMap } from "@/server/catalog/parser";
import { getVideosDir } from "@/server/catalog/storage";
import { generatePoster, posterPath } from "@/server/ffmpeg/posters";
import { getRuntimePaths } from "@/server/runtime/paths";
import { downloadR2File, r2Configured, tenantKey } from "@/server/sync/r2/client";

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
  const cached = posterPath(vidId, postersDir);
  if (!force) {
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

  // Local-first: regenerate from the library file whenever it is on disk.
  // force=1 keeps working as the cache-busting maintenance path.
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
  }

  // Dormant R2 fallback for clips that only exist in the cloud, without
  // materializing the source video into the permanent videos directory.
  if (r2Configured()) {
    try {
      await downloadR2File(clipPosterKey(vidId), cached);
      if (fs.existsSync(cached)) {
        const buf = fs.readFileSync(cached);
        return new NextResponse(buf, {
          headers: {
            "Content-Type": "image/jpeg",
            "Cache-Control": "public, max-age=3600",
            "X-Poster-Source": "r2-cache",
          },
        });
      }
    } catch (err) {
      console.warn(`poster: R2 poster fetch failed for ${vidId}:`, err);
    }
  }

  return notFound();
}
