import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import { parseCatalog, buildVideoMap } from "@/server/catalog/parser";
import { getVideosDir } from "@/server/catalog/storage";
import { generatePoster } from "@/server/ffmpeg/posters";
import { getRuntimePaths } from "@/server/runtime/paths";

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

  const posterFilePath = await generatePoster(video.path, vidId, postersDir, force);
  if (!posterFilePath || !fs.existsSync(posterFilePath)) {
    return NextResponse.json({ success: false, error: "Poster generation failed" }, { status: 500 });
  }

  const buf = fs.readFileSync(posterFilePath);
  return new NextResponse(buf, {
    headers: { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=3600" },
  });
}
