import { NextResponse } from "next/server";
import { VIDEOS_DIR } from "@/server/catalog/storage";
import { parseCatalog } from "@/server/catalog/parser";

export async function GET() {
  try {
    const videos = parseCatalog(undefined, VIDEOS_DIR);
    return NextResponse.json({ videos });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
