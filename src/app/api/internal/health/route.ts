import { NextRequest, NextResponse } from "next/server";
import { getRuntimeConfig } from "@/server/runtime/config";
import { getAssetSource } from "@/server/assets/source";
import { verifyFFmpegAtBoot } from "@/server/ffmpeg/binaries";
import { assertDesktopAuth } from "@/server/runtime/auth";

export async function GET(req: NextRequest) {
  const denied = assertDesktopAuth(req);
  if (denied) return denied;

  const cfg = getRuntimeConfig();
  const workspace = getAssetSource().validateWorkspace();

  let ffmpeg: { ok: boolean; error?: string } = { ok: false };
  try {
    verifyFFmpegAtBoot();
    ffmpeg = { ok: true };
  } catch (err) {
    ffmpeg = { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  return NextResponse.json({
    ok: workspace.ready && ffmpeg.ok,
    desktopMode: cfg.desktopMode,
    workspace,
    ffmpeg,
  });
}
