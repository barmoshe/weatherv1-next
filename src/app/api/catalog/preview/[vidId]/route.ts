import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { parseCatalog, buildVideoMap } from "@/server/catalog/parser";
import { VIDEOS_DIR } from "@/server/catalog/storage";
import { getPreviewPath } from "@/server/ffmpeg/previews";

const PREVIEWS_DIR = path.join(process.cwd(), "runtime", "cache", "previews");

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ vidId: string }> }
) {
  const { vidId } = await params;

  const videos = parseCatalog(undefined, VIDEOS_DIR);
  const videoMap = buildVideoMap(videos);
  const video = videoMap[vidId];
  if (!video) {
    return NextResponse.json({ success: false, error: "Video not found" }, { status: 404 });
  }

  const previewFilePath = await getPreviewPath(video.path, vidId, PREVIEWS_DIR);
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
