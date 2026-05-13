import { describe, expect, it } from "vitest";
import { computeTagCounts } from "@/server/catalog/parser";
import type { ParsedVideo } from "@/shared/types";

function video(patch: Partial<ParsedVideo>): ParsedVideo {
  return {
    id: "vid",
    filename: "vid.mp4",
    path: "/cache/vid.mp4",
    availability: "local",
    description: "",
    duration_sec: 30,
    orientation: "H",
    source: "original",
    segments: [],
    ...patch,
  };
}

describe("catalog aggregate stats", () => {
  it("counts segment totals independently of local cache availability", () => {
    const counts = computeTagCounts([
      video({
        id: "local",
        availability: "local",
        remote: { key: "tenants/t/videos/local/local.mp4" },
        segments: [
          { id: "local-s0", start_sec: 0, end_sec: 8, description: "", tags: ["rain"] },
          { id: "local-s1", start_sec: 8, end_sec: 16, description: "", tags: [] },
        ],
      }),
      video({
        id: "cloud",
        availability: "cloud_only",
        remote: { key: "tenants/t/videos/cloud/cloud.mp4" },
        segments: [
          { id: "cloud-s0", start_sec: 0, end_sec: 9, description: "", tags: [] },
        ],
      }),
      video({
        id: "remote-missing",
        availability: "error",
        segments: [],
      }),
    ]);

    expect(counts.total_clips).toBe(3);
    expect(counts.total_segments).toBe(3);
    expect(counts.multi_segment_clips).toBe(1);
    expect(counts.single_segment_clips).toBe(1);
    expect(counts.clips_with_no_segments).toBe(1);
    expect(counts.remote_available_clips).toBe(2);
    expect(counts.remote_missing_clips).toBe(1);
    expect(counts.cached_local_clips).toBe(1);
    expect(counts.not_cached_local_clips).toBe(2);
    expect(counts.cloud_only_clips).toBe(1);
    expect(counts.error_clips).toBe(1);
  });
});
