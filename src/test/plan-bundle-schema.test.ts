// @vitest-environment node
import { describe, expect, it } from "vitest";
import { PlanBundleSchema, JobRecordSchema, JobsFileSchema } from "@/server/jobs/schema";

describe("plan-bundle and jobs schemas", () => {
  it("PlanBundleSchema allows arbitrary extra fields (passthrough)", () => {
    const parsed = PlanBundleSchema.parse({
      job_id: "abc",
      transcript: "...",
      timeline: [{ scene_idx: 0, start_sec: 0, end_sec: 1 }],
      future_field: { nested: true },
    });
    expect(parsed.job_id).toBe("abc");
    expect((parsed as Record<string, unknown>).future_field).toEqual({ nested: true });
  });

  it("PlanBundleSchema accepts an empty bundle (incremental build)", () => {
    expect(PlanBundleSchema.parse({})).toEqual({});
  });

  it("JobRecordSchema rejects unknown status", () => {
    expect(() =>
      JobRecordSchema.parse({ job_id: "j1", status: "weird" }),
    ).toThrow();
  });

  it("JobRecordSchema strips unknown fields", () => {
    const parsed = JobRecordSchema.parse({
      job_id: "j1",
      status: "queued",
      stale_field: "should be removed",
    } as unknown);
    expect((parsed as Record<string, unknown>).stale_field).toBeUndefined();
  });

  it("JobsFileSchema is a record of JobRecord", () => {
    const parsed = JobsFileSchema.parse({
      j1: { job_id: "j1", status: "completed", output_url: "forecast_j1.mp4" },
      j2: { job_id: "j2", status: "failed", error: "oops" },
    });
    expect(Object.keys(parsed)).toEqual(["j1", "j2"]);
  });

  it("JobsFileSchema rejects when an entry is malformed", () => {
    expect(() =>
      JobsFileSchema.parse({
        j1: { job_id: "j1" },
      }),
    ).toThrow();
  });
});
