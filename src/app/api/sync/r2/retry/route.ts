import { NextRequest, NextResponse } from "next/server";
import { assertDesktopAuth } from "@/server/runtime/auth";
import { retryR2Sync, R2CatalogConflictError } from "@/server/sync/r2/service";
import { kickMirrorQueue, reviveDeadMirrorOps } from "@/server/sync/r2/mirror-queue";

export async function POST(req: NextRequest) {
  const denied = assertDesktopAuth(req);
  if (denied) return denied;
  try {
    const data = (await req.json().catch(() => ({}))) as { video_id?: string };
    // Move any dead-letter mirror ops back to pending and kick the drainer
    // so the same button retries the queue alongside the explicit catalog/video sync.
    const revived = await reviveDeadMirrorOps();
    kickMirrorQueue();
    return NextResponse.json({
      success: true,
      r2: await retryR2Sync(data.video_id),
      mirror_revived: revived,
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: err instanceof R2CatalogConflictError ? 409 : 500 },
    );
  }
}
