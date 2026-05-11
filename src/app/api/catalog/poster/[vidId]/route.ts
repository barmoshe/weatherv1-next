import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { parseCatalog, buildVideoMap } from "@/server/catalog/parser";
import { VIDEOS_DIR } from "@/server/catalog/storage";
import { generatePoster } from "@/server/ffmpeg/posters";

const POSTERS_DIR = path.join(process.cwd(), "runtime", "cache", "posters");

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ vidId: string }> }
) {
  const { vidId } = await params;
  const force = req.nextUrl.searchParams.get("force") === "1";

  const videos = parseCatalog(undefined, VIDEOS_DIR);
  const videoMap = buildVideoMap(videos);
  const video = videoMap[vidId];
  if (!video) {
    return NextResponse.json({ success: false, error: "Video not found" }, { status: 404 });
  }

  const posterFilePath = await generatePoster(video.path, vidId, POSTERS_DIR, force);
  if (!posterFilePath || !fs.existsSync(posterFilePath)) {
    return NextResponse.json({ success: false, error: "Poster generation failed" }, { status: 500 });
  }

  const buf = fs.readFileSync(posterFilePath);
  return new NextResponse(buf, {
    headers: { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=3600" },
  });
}
