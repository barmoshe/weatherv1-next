import fs from "node:fs";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { getRuntimePaths } from "@/server/runtime/paths";
import { hydratePlanBundleFromR2, readPlanBundle } from "@/server/jobs/plan-bundle";
import { hydrateVoiceoverFromR2 } from "@/server/sync/r2/hydrate-voiceover";
import { serveRuntimeFile } from "@/server/runtime/serve-file";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const { jobId } = await params;

  // Self-heal: if the local plan bundle is missing or has no audio_filename,
  // try restoring it from R2 first. Mirrors what /api/plan/<jobId> already does.
  let bundle = readPlanBundle(jobId) as { audio_filename?: string };
  if (!bundle.audio_filename) {
    await hydratePlanBundleFromR2(jobId).catch(() => false);
    bundle = readPlanBundle(jobId) as { audio_filename?: string };
  }
  const audioFilename = bundle.audio_filename;
  if (!audioFilename) {
    return NextResponse.json({ error: "Audio not found" }, { status: 404 });
  }

  // Self-heal: when the bundle was restored from R2 onto a machine that never
  // ran /api/transcribe, the local uploads/<filename> file doesn't exist yet.
  // Pull it down from voiceovers/<jobId>/<basename> before serving so the
  // review-card audio element can play instead of throwing NotSupportedError.
  const { uploadsDir } = getRuntimePaths();
  const localPath = path.join(uploadsDir, path.basename(audioFilename));
  if (!fs.existsSync(localPath)) {
    try {
      fs.mkdirSync(uploadsDir, { recursive: true });
      await hydrateVoiceoverFromR2(jobId, audioFilename, localPath);
    } catch (err) {
      console.warn(
        `[voiceovers] R2 hydrate failed for ${jobId}:`,
        err instanceof Error ? err.message : err,
      );
      return NextResponse.json({ error: "Audio not found" }, { status: 404 });
    }
  }

  return serveRuntimeFile({
    dir: uploadsDir,
    filename: audioFilename,
    range: req.headers.get("range"),
    cacheControl: "private, max-age=60",
  });
}
