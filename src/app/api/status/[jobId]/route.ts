import { NextRequest, NextResponse } from "next/server";
import { getJob } from "@/server/jobs/store";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const { jobId } = await params;
  const job = getJob(jobId);
  if (!job) return NextResponse.json({ success: false, error: "Job not found" }, { status: 404 });

  return NextResponse.json({
    success: true,
    status: job.status,
    output_url: job.output_url ?? null,
    error: job.error ?? null,
  });
}
