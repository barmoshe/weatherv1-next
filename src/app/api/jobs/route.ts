import { NextResponse } from "next/server";
import { readPlanBundle } from "@/server/jobs/plan-bundle";
import { getAllJobs } from "@/server/jobs/store";

function transcriptPreview(jobId: string): string | undefined {
  const bundle = readPlanBundle(jobId);
  const t = bundle.transcript;
  if (typeof t !== "string") return undefined;
  const s = t.trim();
  if (!s) return undefined;
  return s.slice(0, 80);
}

export async function GET() {
  const jobs = getAllJobs()
    .map((job) => ({
      job_id: job.job_id,
      status: job.status,
      created_at: job.created_at ?? new Date(0).toISOString(),
      audio_filename: job.audio_filename,
      output_url: job.output_url ?? undefined,
      transcript_preview: transcriptPreview(job.job_id),
    }))
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));

  return NextResponse.json({ success: true, jobs });
}
