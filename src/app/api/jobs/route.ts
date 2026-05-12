import { NextResponse } from "next/server";
import { getAllJobs } from "@/server/jobs/store";

export async function GET() {
  const jobs = getAllJobs()
    .map((job) => ({
      job_id: job.job_id,
      status: job.status,
      created_at: job.created_at ?? new Date(0).toISOString(),
      audio_filename: job.audio_filename,
      output_url: job.output_url ?? undefined,
    }))
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));

  return NextResponse.json({ success: true, jobs });
}
