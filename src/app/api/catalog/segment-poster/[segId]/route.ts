import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import { parseCatalog, buildVideoMap } from "@/server/catalog/parser";
import { VIDEOS_DIR } from "@/server/catalog/storage";
import { generateSegmentPoster } from "@/server/ffmpeg/segment-posters";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ segId: string }> }
) {
  const { segId } = await params;
  const force = req.nextUrl.searchParams.get("force") === "1";

  const videos = parseCatalog(undefined, VIDEOS_DIR);
  const videoMap = buildVideoMap(videos);

  const posterFilePath = await generateSegmentPoster(segId, videoMap, force);
  if (!posterFilePath || !fs.existsSync(posterFilePath)) {
    return NextResponse.json({ success: false, error: "Poster generation failed" }, { status: 500 });
  }

  const buf = fs.readFileSync(posterFilePath);
  return new NextResponse(buf, {
    headers: { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=3600" },
  });
}
