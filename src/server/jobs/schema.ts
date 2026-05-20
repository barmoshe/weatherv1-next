import { z } from "zod";

export const JobStatusSchema = z.enum([
  "draft",
  "queued",
  "processing",
  "completed",
  "failed",
]);

/**
 * Per-job record persisted in `runtime/jobs.json`. Known shape — strip
 * unknown fields on read so stale or hand-edited keys don't leak through.
 */
export const JobRecordSchema = z.object({
  job_id: z.string(),
  status: JobStatusSchema,
  output_url: z.string().nullable().optional(),
  error: z.string().nullable().optional(),
  error_code: z.string().nullable().optional(),
  error_provider: z.string().nullable().optional(),
  error_console_url: z.string().nullable().optional(),
  failed_step: z.string().nullable().optional(),
  failed_at: z.string().nullable().optional(),
  created_at: z.string().optional(),
  audio_filename: z.string().optional(),
  usage_summary: z.unknown().optional(),
  usage_calls: z.array(z.unknown()).optional(),
});

/** `jobs.json` is a flat map of `jobId -> JobRecord`. */
export const JobsFileSchema = z.record(z.string(), JobRecordSchema);

/**
 * Plan bundle schema — known fields are loose; unknown fields pass through.
 * The pipeline merges incrementally into the same file, so the shape grows
 * step-by-step (transcript → scenes → timeline → render output).
 */
export const PlanBundleSchema = z
  .object({
    job_id: z.string().optional(),
  })
  .passthrough();
