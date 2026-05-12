import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import { parseCatalog, buildVideoMap } from "@/server/catalog/parser";
import { getVideosDir } from "@/server/catalog/storage";
import { getPreviewPath } from "@/server/ffmpeg/previews";
import { getRuntimePaths } from "@/server/runtime/paths";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ vidId: string }> }
) {
  const { vidId } = await params;
  const { previewsDir } = getRuntimePaths();

  const videos = parseCatalog(undefined, getVideosDir());
  const videoMap = buildVideoMap(videos);
  const video = videoMap[vidId];
  if (!video) {
    return NextResponse.json({ success: false, error: "Video not found" }, { status: 404 });
  }

  const previewFilePath = await getPreviewPath(video.path, vidId, previewsDir);
  if (!previewFilePath || !fs.existsSync(previewFilePath)) {
    return NextResponse.json({ success: false, error: "Preview not available" }, { status: 500 });
  }

  const stat = fs.statSync(previewFilePath);
  const buf = fs.readFileSync(previewFilePath);
  return new NextResponse(buf, {
    headers: {
      "Content-Type": "video/mp4",
      "Content-Length": String(stat.size),
      "Cache-Control": "public, max-age=3600",
      "Accept-Ranges": "bytes",
    },
  });
}
