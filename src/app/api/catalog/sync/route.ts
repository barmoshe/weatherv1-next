import { NextRequest, NextResponse } from "next/server";
import { assertDesktopAuth } from "@/server/runtime/auth";
import { catalogStoreStatus, pullCatalogFromDrive } from "@/server/catalog/storage";

export async function GET() {
  return NextResponse.json({ success: true, store: catalogStoreStatus() });
}

export async function POST(req: NextRequest) {
  const denied = assertDesktopAuth(req);
  if (denied) return denied;

  try {
    const store = await pullCatalogFromDrive();
    return NextResponse.json({ success: true, store });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
