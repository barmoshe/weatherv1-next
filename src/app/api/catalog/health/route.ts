import { NextResponse } from "next/server";
import { parseCatalog, lastHealth } from "@/server/catalog/parser";
import { VIDEOS_DIR } from "@/server/catalog/storage";

export async function GET() {
  try {
    // Re-parse to refresh health stats
    parseCatalog(undefined, VIDEOS_DIR);
    return NextResponse.json({ success: true, health: lastHealth });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
