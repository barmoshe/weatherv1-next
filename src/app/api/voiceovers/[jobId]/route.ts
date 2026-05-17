import { NextRequest, NextResponse } from "next/server";
import { getRuntimePaths } from "@/server/runtime/paths";
import { readPlanBundle } from "@/server/jobs/plan-bundle";
import { serveRuntimeFile } from "@/server/runtime/serve-file";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const { jobId } = await params;
  const { audio_filename } = readPlanBundle(jobId) as { audio_filename?: string };
  if (!audio_filename) {
    return NextResponse.json({ error: "Audio not found" }, { status: 404 });
  }
  return serveRuntimeFile({
    dir: getRuntimePaths().uploadsDir,
    filename: audio_filename,
    range: req.headers.get("range"),
    cacheControl: "private, max-age=60",
  });
}
