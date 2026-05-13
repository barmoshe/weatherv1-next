import { NextRequest, NextResponse } from "next/server";
import { assertDesktopAuth } from "@/server/runtime/auth";
import { getR2SyncStatus, pullCatalogFromR2IfLocalEmpty } from "@/server/sync/r2/service";

export async function GET(req: NextRequest) {
  const denied = assertDesktopAuth(req);
  if (denied) return denied;
  await pullCatalogFromR2IfLocalEmpty();
  return NextResponse.json({ success: true, r2: await getR2SyncStatus() });
}
