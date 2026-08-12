import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { prepareRenderMedia } from "@/server/jobs/render-media";
import type { ParsedVideo, ResolvedPick } from "@/shared/types";

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "weatherv1-render-media-"));
}

function video(patch: Partial<ParsedVideo> = {}): ParsedVideo {
  return {
    id: "clip-1",
    filename: "clip-1.mp4",
    path: "/permanent/videos/clip-1.mp4",
    availability: "cloud_only",
    description: "",
    duration_sec: 60,
    orientation: "V",
    source: "original",
    remote: { key: "tenants/t/videos/clip-1/clip-1.mp4" },
    segments: [],
    ...patch,
  };
}

function pick(patch: Partial<ResolvedPick> = {}): ResolvedPick {
  return {
    scene_idx: 0,
    segment_id: "clip-1-s0",
    video_id: "clip-1",
    audio_start: 0,
    audio_end: 6,
    video_start: 12,
    video_end: 18,
    reason: "",
    ...patch,
  };
}

let tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
  tempDirs = [];
});

describe("render media preparation", () => {
  it("downloads source media to job temp and cuts render-ready segment files", async () => {
    const tempRoot = makeTempDir();
    tempDirs.push(tempRoot);
    const downloadObject = vi.fn(async (_key: string, targetPath: string) => {
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      fs.writeFileSync(targetPath, "source");
      return { size: 6 };
    });
    const cutSegment = vi.fn(async ({ outputPath }: { outputPath: string }) => {
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, "segment");
    });

    const prepared = await prepareRenderMedia(
      [pick()],
      { "clip-1": video() },
      "job-1",
      { tempRoot, downloadObject, cutSegment },
    );

    expect(downloadObject).toHaveBeenCalledWith("tenants/t/videos/clip-1/clip-1.mp4", expect.stringContaining("sources"));
    expect(cutSegment).toHaveBeenCalledWith(expect.objectContaining({
      start: 12,
      decodeDur: 6,
      padDur: 0,
      jobId: "job-1",
    }));
    expect(prepared.timeline[0]).toMatchObject({ video_start: 0, video_end: 6 });
    expect(prepared.videoMap[prepared.timeline[0].video_id].path).toContain("segments");
    expect(prepared.videoMap[prepared.timeline[0].video_id].path).not.toBe("/permanent/videos/clip-1.mp4");
    expect(fs.existsSync(prepared.tempDir)).toBe(true);

    await prepared.cleanup();
    expect(fs.existsSync(prepared.tempDir)).toBe(false);
  });

  it("pads cutSegment when narration is longer than available video trim", async () => {
    const tempRoot = makeTempDir();
    tempDirs.push(tempRoot);
    const downloadObject = vi.fn(async (_key: string, targetPath: string) => {
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      fs.writeFileSync(targetPath, "source");
      return { size: 6 };
    });
    const cutSegment = vi.fn(async ({ outputPath }: { outputPath: string }) => {
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, "segment");
    });

    await prepareRenderMedia(
      [
        pick({
          audio_start: 0,
          audio_end: 8,
          video_start: 10,
          video_end: 12,
        }),
      ],
      { "clip-1": video() },
      "job-pad",
      { tempRoot, downloadObject, cutSegment },
    );

    expect(cutSegment).toHaveBeenCalledWith(
      expect.objectContaining({
        start: 10,
        decodeDur: 2,
        padDur: 6,
      }),
    );
  });

  it("cuts directly from the local library file without downloading", async () => {
    const tempRoot = makeTempDir();
    tempDirs.push(tempRoot);
    const libraryDir = makeTempDir();
    tempDirs.push(libraryDir);
    const libraryFile = path.join(libraryDir, "clip-1.mp4");
    fs.writeFileSync(libraryFile, "library-source");

    const downloadObject = vi.fn();
    const cutSegment = vi.fn(async ({ outputPath }: { outputPath: string }) => {
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, "segment");
    });

    const prepared = await prepareRenderMedia(
      [pick()],
      { "clip-1": video({ path: libraryFile, availability: "local" }) },
      "job-local",
      { tempRoot, downloadObject, cutSegment },
    );

    expect(downloadObject).not.toHaveBeenCalled();
    expect(cutSegment).toHaveBeenCalledWith(expect.objectContaining({ sourcePath: libraryFile }));

    await prepared.cleanup();
    expect(fs.existsSync(libraryFile)).toBe(true);
  });

  it("fails clearly when a clip is neither on disk nor fetchable", async () => {
    const tempRoot = makeTempDir();
    tempDirs.push(tempRoot);

    await expect(
      prepareRenderMedia([pick()], { "clip-1": video({ remote: undefined }) }, "job-2", { tempRoot }),
    ).rejects.toThrow("is not available locally");

    await expect(
      prepareRenderMedia([pick()], { "clip-1": video() }, "job-3", { tempRoot }),
    ).rejects.toThrow("R2 sync is disabled");
  });
});
