import { NextRequest, NextResponse } from "next/server";
import { getJob } from "@/server/jobs/store";
import { queuePosition } from "@/server/jobs/worker";

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
    error_code: job.error_code ?? null,
    error_provider: job.error_provider ?? null,
    error_console_url: job.error_console_url ?? null,
    failed_step: job.failed_step ?? null,
    failed_at: job.failed_at ?? null,
    progress: job.progress ?? null,
    eta_sec: job.eta_sec ?? null,
    queue_position: job.status === "queued" ? queuePosition(jobId) : null,
  });
}
