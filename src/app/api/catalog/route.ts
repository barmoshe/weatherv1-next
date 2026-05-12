import { NextResponse } from "next/server";
import { getVideosDir } from "@/server/catalog/storage";
import { parseCatalog } from "@/server/catalog/parser";

export async function GET() {
  try {
    const videos = parseCatalog(undefined, getVideosDir());
    return NextResponse.json({ videos });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
