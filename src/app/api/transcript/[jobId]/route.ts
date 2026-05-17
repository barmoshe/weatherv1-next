import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { readPlanBundle, updatePlanBundle } from "@/server/jobs/plan-bundle";

const SegmentSchema = z.object({
  idx: z.number().int().nonnegative().optional(),
  start: z.number().nonnegative(),
  end: z.number().nonnegative(),
  text: z.string(),
});

const BodySchema = z.object({
  transcript: z.string().min(1),
  segments: z.array(SegmentSchema).optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const { jobId } = await params;
  if (!jobId) {
    return NextResponse.json({ success: false, error: "Missing jobId" }, { status: 400 });
  }

  // Confirm a bundle exists before letting the caller patch arbitrary ids.
  const existing = readPlanBundle(jobId) as { job_id?: unknown };
  if (existing.job_id !== jobId) {
    return NextResponse.json({ success: false, error: "Job not found" }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: "Invalid body", details: parsed.error.issues },
      { status: 400 },
    );
  }

  const fields: Record<string, unknown> = { transcript: parsed.data.transcript };
  if (parsed.data.segments) fields.transcript_segments = parsed.data.segments;

  const next = await updatePlanBundle(jobId, fields) as {
    transcript?: unknown;
    transcript_segments?: unknown;
  };

  return NextResponse.json({
    success: true,
    transcript: next.transcript ?? "",
    segments: next.transcript_segments ?? [],
  });
}
