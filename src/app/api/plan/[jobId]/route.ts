import { NextRequest, NextResponse } from "next/server";
import { readPlanBundle } from "@/server/jobs/plan-bundle";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const { jobId } = await params;
  const bundle = readPlanBundle(jobId);
  if (!bundle.job_id) {
    return NextResponse.json({ success: false, error: "Plan not found" }, { status: 404 });
  }
  return NextResponse.json({ success: true, plan: bundle });
}
