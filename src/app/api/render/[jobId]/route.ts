import { NextRequest, NextResponse } from "next/server";
import { getJob, updateJob } from "@/server/jobs/store";
import { killProcess } from "@/server/ffmpeg/spawn";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const { jobId } = await params;
  const job = getJob(jobId);
  if (!job) return NextResponse.json({ success: false, error: "Job not found" }, { status: 404 });

  // Kill any running ffmpeg process for this job
  killProcess(jobId);

  updateJob(jobId, { status: "failed", error: "Cancelled by user" });
  return NextResponse.json({ success: true, job_id: jobId });
}
