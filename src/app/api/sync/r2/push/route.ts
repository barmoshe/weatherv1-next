import { NextRequest, NextResponse } from "next/server";
import { assertDesktopAuth } from "@/server/runtime/auth";
import { pushCatalogToR2, R2CatalogConflictError } from "@/server/sync/r2/service";

export async function POST(req: NextRequest) {
  const denied = assertDesktopAuth(req);
  if (denied) return denied;
  try {
    return NextResponse.json({ success: true, r2: await pushCatalogToR2() });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: err instanceof R2CatalogConflictError ? 409 : 500 },
    );
  }
}
