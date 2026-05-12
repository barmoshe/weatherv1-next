import { NextRequest, NextResponse } from "next/server";
import { getAssetSource } from "@/server/assets/source";
import { getRuntimeConfig } from "@/server/runtime/config";
import { getRuntimePaths } from "@/server/runtime/paths";
import { assertDesktopAuth } from "@/server/runtime/auth";

export async function GET(req: NextRequest) {
  const denied = assertDesktopAuth(req);
  if (denied) return denied;

  const config = getRuntimeConfig();
  const runtime = getRuntimePaths();
  const workspace = getAssetSource().validateWorkspace();

  return NextResponse.json({
    success: true,
    desktop_mode: config.desktopMode,
    workspace,
    runtime: {
      runtime_dir: runtime.runtimeDir,
      uploads_dir: runtime.uploadsDir,
      outputs_dir: runtime.outputsDir,
      cache_dir: runtime.cacheDir,
    },
    keys: {
      openai_configured: Boolean(process.env.OPENAI_API_KEY),
      gemini_configured: Boolean(process.env.GEMINI_API_KEY),
    },
    ffmpeg: {
      ffmpeg_path: config.ffmpegPath ?? null,
      ffprobe_path: config.ffprobePath ?? null,
      bg_music_path: config.bgMusicPath,
    },
  });
}
