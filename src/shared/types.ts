import { z } from "zod";

// ---------------------------------------------------------------------------
// Branded types
// ---------------------------------------------------------------------------

export type SegmentId = string & { readonly __brand: "SegmentId" };
export type ClipId = string & { readonly __brand: "ClipId" };

export function toSegmentId(s: string): SegmentId {
  return s as SegmentId;
}
export function toClipId(s: string): ClipId {
  return s as ClipId;
}

/** Extract clip ID from "IB003-s2" → "IB003" */
export function clipIdFromSegmentId(segId: string): string {
  const idx = segId.lastIndexOf("-s");
  return idx === -1 ? segId : segId.slice(0, idx);
}

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

export const SegmentConceptsSchema = z.object({
  weather: z.array(z.string()).optional().default([]),
  season_mood: z.array(z.string()).optional().default([]),
  visual_role: z.array(z.string()).optional().default([]),
  scene_fit: z.array(z.string()).optional().default([]),
  avoid_for: z.array(z.string()).optional().default([]),
});
export type SegmentConcepts = z.infer<typeof SegmentConceptsSchema>;

export const SegmentEntrySchema = z.object({
  id: z.string().optional(),
  start_sec: z.number(),
  end_sec: z.number(),
  description: z.string().optional().default(""),
  tags: z.array(z.string()).optional().default([]),
  concepts: SegmentConceptsSchema.optional(),
  confidence: z.number().min(0).max(1).optional(),
});
export type SegmentEntry = z.infer<typeof SegmentEntrySchema>;

export const LegacyTagsSchema = z
  .object({
    main: z.string().optional().default(""),
    secondary: z.string().optional().default(""),
    third: z.string().optional().default(""),
  })
  .optional();

export const CatalogEntrySchema = z.object({
  id: z.string(),
  filename: z.string(),
  description: z.string().optional().default(""),
  duration_sec: z.number().default(0),
  orientation: z.enum(["H", "V"]).default("V"),
  source: z.preprocess(
    (v) => (v == null ? "original" : v),
    z.enum(["getty", "artlist", "whatsapp", "original", "other"]),
  ),
  tags: LegacyTagsSchema,
  segments: z.array(SegmentEntrySchema).optional().default([]),
  added_at: z.string().optional(),
  original_filename: z.string().optional(),
  remote: z
    .object({
      key: z.string().optional(),
      etag: z.string().optional(),
      size: z.number().optional(),
      uploadedAt: z.string().optional(),
      status: z.enum(["local", "cloud_only", "uploading", "downloading", "syncing", "error"]).optional(),
      error: z.string().optional(),
    })
    .optional(),
});
export type CatalogEntry = z.infer<typeof CatalogEntrySchema>;

export const CatalogSchema = z.object({
  tag_schema: z.unknown().optional(),
  videos: z.array(CatalogEntrySchema),
  updated_at: z.string().optional(),
});
export type Catalog = z.infer<typeof CatalogSchema>;

// ---------------------------------------------------------------------------
// Parsed video (catalog entry with resolved path + normalised segments)
// ---------------------------------------------------------------------------

export interface NormalisedSegment extends SegmentEntry {
  id: string; // always set (never undefined after parsing)
}

export interface ParsedVideo extends CatalogEntry {
  path: string; // absolute path to video file
  availability: "local" | "cloud_only" | "syncing" | "error";
  segments: NormalisedSegment[];
}

export interface SegmentMapEntry {
  clip: ParsedVideo;
  segment: NormalisedSegment;
}

// ---------------------------------------------------------------------------
// Whisper / transcript
// ---------------------------------------------------------------------------

export const WhisperSegmentSchema = z.object({
  idx: z.number().optional(),
  start: z.number(),
  end: z.number(),
  text: z.string(),
});
export type WhisperSegment = z.infer<typeof WhisperSegmentSchema>;

// ---------------------------------------------------------------------------
// Scene planner
// ---------------------------------------------------------------------------

export const SceneKindSchema = z.enum(["prose", "list", "transition"]);
export type SceneKind = z.infer<typeof SceneKindSchema>;

export const SceneMoodSchema = z
  .enum(["cheerful", "calm", "dramatic", "gloomy"])
  .optional();

export const SceneSchema = z.object({
  idx: z.number(),
  start_sec: z.number(),
  end_sec: z.number(),
  title_he: z.string(),
  narration: z.string(),
  keywords: z.array(z.string()).default([]),
  mood: SceneMoodSchema,
  kind: SceneKindSchema.default("prose"),
  heterogeneous: z.boolean().default(false),
  whisper_beat_indices: z.array(z.number()).default([]),
});
export type Scene = z.infer<typeof SceneSchema>;

// ---------------------------------------------------------------------------
// Timeline picks (before and after validation)
// ---------------------------------------------------------------------------

export const TimelinePickSchema = z.object({
  scene_idx: z.number(),
  segment_id: z.string(),
  audio_start: z.number(),
  audio_end: z.number(),
  video_start: z.number().optional(),
  video_end: z.number().optional(),
  reason: z.string().optional().default(""),
  /** LLM editorial "why this segment" before validator mutates `reason` (optional, stamped server-side). */
  picker_reason: z.string().optional(),
});
export type TimelinePick = z.infer<typeof TimelinePickSchema>;

export const ResolvedPickSchema = TimelinePickSchema.extend({
  video_id: z.string(),
  video_start: z.number(),
  video_end: z.number(),
  beat_idx: z.number().optional(),
});
export type ResolvedPick = z.infer<typeof ResolvedPickSchema>;

// ---------------------------------------------------------------------------
// Validator output
// ---------------------------------------------------------------------------

export const ViolationRecordSchema = z.object({
  issue: z.string(),
  segment_id: z.string().optional(),
  video_id: z.string().optional(),
  original: z.string().optional(),
  swapped_to: z.string().optional(),
  swap_reason: z.string().default(""),
  fixed: z.boolean(),
  action: z.string().optional(),
});
export type ViolationRecord = z.infer<typeof ViolationRecordSchema>;

export const WarningRecordSchema = z.object({
  issue: z.string(),
  segment_id: z.string().optional(),
  video_id: z.string().optional(),
  tag: z.string().optional(),
  run_length: z.number().optional(),
  indices: z.array(z.number()).optional(),
  segment_ids: z.array(z.string()).optional(),
  message: z.string().optional(),
});
export type WarningRecord = z.infer<typeof WarningRecordSchema>;

export const GapFillRecordSchema = z.object({
  scene_idx: z.number(),
  issue: z.string().default("scene has no pick"),
  fixed: z.boolean(),
  filled_with: z.string().optional(),
  fill_reason: z.string().default(""),
});
export type GapFillRecord = z.infer<typeof GapFillRecordSchema>;

export const CatalogHealthSchema = z.object({
  loaded_clips: z.number(),
  loaded_segments: z.number(),
  tagged_segments: z.number(),
  untagged_picks: z.number(),
});

export const ValidatorBundleSchema = z.object({
  score: z.number().default(100),
  hard_violations_fixed: z.array(ViolationRecordSchema).default([]),
  hard_violations_kept: z.array(ViolationRecordSchema).default([]),
  warnings: z.array(WarningRecordSchema).default([]),
  gap_filled: z.array(GapFillRecordSchema).default([]),
  catalog_health: CatalogHealthSchema.optional(),
});
export type ValidatorBundle = z.infer<typeof ValidatorBundleSchema>;

// ---------------------------------------------------------------------------
// Plan bundle (grows incrementally across transcribe → plan → render)
// ---------------------------------------------------------------------------

export const PlanBundleSchema = z.object({
  job_id: z.string(),
  created_at: z.string(),
  updated_at: z.string().optional(),
  audio_filename: z.string(),
  duration_sec: z.number(),
  transcript: z.string().default(""),
  transcript_segments: z.array(WhisperSegmentSchema).default([]),
  scenes: z.array(SceneSchema).optional(),
  timeline: z.array(ResolvedPickSchema).default([]),
  validator: ValidatorBundleSchema.optional(),
  system_prompt: z.string().optional(),
  catalog_snapshot: z.unknown().optional(),
});
export type PlanBundle = z.infer<typeof PlanBundleSchema>;

// ---------------------------------------------------------------------------
// Job lifecycle
// ---------------------------------------------------------------------------

export const JobStatusSchema = z.enum([
  "draft",
  "queued",
  "processing",
  "completed",
  "failed",
]);
export type JobStatus = z.infer<typeof JobStatusSchema>;

export const JobRecordSchema = z.object({
  job_id: z.string(),
  status: JobStatusSchema,
  output_url: z.string().nullable().default(null),
  error: z.string().nullable().default(null),
  created_at: z.string(),
  updated_at: z.string().optional(),
});
export type JobRecord = z.infer<typeof JobRecordSchema>;

// ---------------------------------------------------------------------------
// API response shapes
// ---------------------------------------------------------------------------

export interface ApiSuccess<T = unknown> {
  success: true;
  data?: T;
}

export interface ApiError {
  success: false;
  error: string;
  error_code?: string;
}

export type ApiResponse<T = unknown> = ApiSuccess<T> | ApiError;

// ---------------------------------------------------------------------------
// Catalog health (from metadata parser)
// ---------------------------------------------------------------------------

export interface CatalogFileHealth {
  version: string;
  claimed_count: number;
  loaded_count: number;
  missing_ids: string[];
}
