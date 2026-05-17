import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { getRuntimePaths } from "@/server/runtime/paths";
import { readPlanBundle } from "@/server/jobs/plan-bundle";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const { jobId } = await params;
  const bundle = readPlanBundle(jobId) as { audio_filename?: unknown };
  const raw = typeof bundle.audio_filename === "string" ? bundle.audio_filename : "";
  if (!raw) {
    return NextResponse.json({ error: "Audio not found" }, { status: 404 });
  }
  const safe = path.basename(raw);
  const filePath = path.join(getRuntimePaths().uploadsDir, safe);
  if (!fs.existsSync(filePath)) {
    return NextResponse.json({ error: "Audio not found" }, { status: 404 });
  }
  const data = fs.readFileSync(filePath);
  const ext = path.extname(safe).toLowerCase();
  const contentType =
    ext === ".mp3" ? "audio/mpeg" :
    ext === ".wav" ? "audio/wav" :
    ext === ".m4a" ? "audio/mp4" :
    ext === ".ogg" ? "audio/ogg" :
    "application/octet-stream";

  return new NextResponse(data, {
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(data.length),
      "Accept-Ranges": "bytes",
      "Cache-Control": "private, max-age=60",
    },
  });
}
