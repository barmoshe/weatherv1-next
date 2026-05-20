import { NextRequest, NextResponse } from "next/server";
import { getJob, updateJob } from "@/server/jobs/store";
import { clearJobFailure } from "@/server/jobs/failure";
import { enqueueJob } from "@/server/jobs/worker";
import { readPlanBundle } from "@/server/jobs/plan-bundle";
import { assertDesktopAuth } from "@/server/runtime/auth";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const denied = assertDesktopAuth(req);
  if (denied) return denied;

  const { jobId } = await params;
  const job = getJob(jobId);
  if (!job) {
    return NextResponse.json({ success: false, error: "Job not found" }, { status: 404 });
  }
  if (job.status !== "failed" && job.status !== "cancelled") {
    return NextResponse.json(
      { success: false, error: `Cannot retry a job in status '${job.status}'` },
      { status: 409 },
    );
  }

  // Failures before the timeline existed (scene planner / picker) can't be
  // re-queued for render — the client must re-run /api/plan with the transcript
  // from the bundle. The worker only ever handles the render step.
  if (job.failed_step === "scene_planner" || job.failed_step === "picker") {
    return NextResponse.json({ success: true, job_id: jobId, resume: "plan" });
  }

  if (!job.audio_filename) {
    return NextResponse.json(
      { success: false, error: "Job has no audio file on record; cannot retry render." },
      { status: 422 },
    );
  }

  const bundle = readPlanBundle(jobId);
  const timeline = bundle.timeline as unknown[] | undefined;
  if (!timeline?.length) {
    return NextResponse.json(
      { success: false, error: "Plan bundle has no timeline; cannot retry render." },
      { status: 422 },
    );
  }

  updateJob(jobId, { status: "queued" });
  clearJobFailure(jobId);

  enqueueJob(jobId);

  return NextResponse.json({ success: true, job_id: jobId, resume: "render" });
}
