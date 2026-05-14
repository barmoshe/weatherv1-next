import { NextRequest, NextResponse } from "next/server";
import { assertDesktopAuth } from "@/server/runtime/auth";
import { clearDerivedRuntimeCaches } from "@/server/runtime/clear-derived-cache";

export async function POST(req: NextRequest) {
  const denied = assertDesktopAuth(req);
  if (denied) return denied;

  try {
    const result = await clearDerivedRuntimeCaches();
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
