import { NextRequest, NextResponse } from "next/server";
import { assertDesktopAuth } from "@/server/runtime/auth";
import { materializeVideo } from "@/server/sync/r2/service";

export async function POST(req: NextRequest) {
  const denied = assertDesktopAuth(req);
  if (denied) return denied;
  try {
    const data = (await req.json().catch(() => ({}))) as { video_id?: string };
    if (!data.video_id) {
      return NextResponse.json({ success: false, error: "Missing video_id" }, { status: 400 });
    }
    return NextResponse.json({ success: true, video: await materializeVideo(data.video_id) });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
