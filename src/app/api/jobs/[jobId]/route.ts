import { NextRequest, NextResponse } from "next/server";
import { deleteJob, getJob } from "@/server/jobs/store";
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
  if (!job) return NextResponse.json({ success: true, job_id: jobId, deleted: false });

  killProcess(jobId);
  deleteJob(jobId);
  return NextResponse.json({ success: true, job_id: jobId, deleted: true });
}
