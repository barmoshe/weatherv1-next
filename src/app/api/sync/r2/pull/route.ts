import { NextRequest, NextResponse } from "next/server";
import { assertDesktopAuth } from "@/server/runtime/auth";
import { pullCatalogFromR2, pullJobsFromR2 } from "@/server/sync/r2/service";

export async function POST(req: NextRequest) {
  const denied = assertDesktopAuth(req);
  if (denied) return denied;
  try {
    const r2 = await pullCatalogFromR2();
    await pullJobsFromR2({ force: true });
    return NextResponse.json({ success: true, r2 });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
