import { NextRequest, NextResponse } from "next/server";
import { getJob } from "@/server/jobs/store";
import { markCancelled } from "@/server/jobs/failure";
import { killProcess } from "@/server/ffmpeg/spawn";
import { assertDesktopAuth } from "@/server/runtime/auth";

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const denied = assertDesktopAuth(req);
  if (denied) return denied;

  const { jobId } = await params;
  const job = getJob(jobId);
  if (!job) return NextResponse.json({ success: false, error: "Job not found" }, { status: 404 });

  // Kill any running ffmpeg process for this job
  killProcess(jobId);

  // Cancellation is not a failure — keep the job retryable, no error banner.
  markCancelled(jobId);
  return NextResponse.json({ success: true, job_id: jobId });
}
