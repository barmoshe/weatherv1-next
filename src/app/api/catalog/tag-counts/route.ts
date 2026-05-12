import { NextResponse } from "next/server";
import { parseCatalog, computeTagCounts } from "@/server/catalog/parser";
import { getVideosDir } from "@/server/catalog/storage";

export async function GET() {
  try {
    const videos = parseCatalog(undefined, getVideosDir());
    const counts = computeTagCounts(videos);
    return NextResponse.json({ success: true, ...counts });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
