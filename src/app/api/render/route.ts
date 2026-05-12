import { NextRequest, NextResponse } from "next/server";
import { updatePlanBundle } from "@/server/jobs/plan-bundle";
import { upsertJob, getJob } from "@/server/jobs/store";
import { enqueueJob } from "@/server/jobs/worker";
import { lastHealth } from "@/server/catalog/parser";
import { assertDesktopAuth } from "@/server/runtime/auth";

export async function POST(req: NextRequest) {
  const denied = assertDesktopAuth(req);
  if (denied) return denied;

  const data = (await req.json()) as Record<string, unknown>;
  const timeline = data.timeline as unknown[] | undefined;
  const audioFilename = data.audio_filename as string | undefined;
  const jobId = data.job_id as string | undefined;

  if (!timeline?.length || !audioFilename) {
    return NextResponse.json({ success: false, error: "Missing data" }, { status: 400 });
  }
  if (!jobId) {
    return NextResponse.json({ success: false, error: "Missing job_id" }, { status: 400 });
  }

  updatePlanBundle(jobId, {
    audio_filename: audioFilename,
    system_prompt: data.system_prompt,
    catalog_snapshot: { ...lastHealth },
    scenes: data.scenes,
    timeline,
    validator: data.validator,
  });

  const existing = getJob(jobId);
  upsertJob({
    job_id: jobId,
    status: "queued",
    output_url: existing?.output_url ?? null,
    error: null,
    audio_filename: audioFilename,
    created_at: existing?.created_at ?? new Date().toISOString(),
  });

  enqueueJob(jobId);

  return NextResponse.json({ success: true, job_id: jobId });
}
