import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildRendererArgs } from "@/server/ffmpeg/renderer";
import type { ResolvedPick, ParsedVideo } from "@/shared/types";
import type { ProbeResult } from "@/server/ffmpeg/probe";

const { mockExistsSync, mockProbeVideo } = vi.hoisted(() => ({
  mockExistsSync: vi.fn<() => boolean>(() => false),
  mockProbeVideo: vi.fn<(path: string) => Promise<ProbeResult>>(),
}));

vi.mock("@/server/ffmpeg/probe", () => ({ probeVideo: mockProbeVideo }));
vi.mock("@/server/ffmpeg/binaries", () => ({ getFFmpegPath: vi.fn(() => "ffmpeg") }));
vi.mock("node:fs", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs")>();
  const mocked = { ...original, existsSync: mockExistsSync };
  return { ...mocked, default: mocked };
});

function makeProbeResult(durationSec: number): ProbeResult {
  return { durationSec, width: 1920, height: 1080, orientation: "V", videoCodec: "h264", pixFmt: "yuv420p", hasAudio: false };
}

function vid(id: string): ParsedVideo {
  return {
    id, filename: `${id}.mp4`, path: `/videos/${id}.mp4`,
    description: "", duration_sec: 30, orientation: "V", source: "original",
    tags: { main: "", secondary: "", third: "" }, segments: [],
  };
}

function pick(videoId: string, start: number, end: number, audioStart: number, audioEnd: number): ResolvedPick {
  return {
    scene_idx: 0, segment_id: `${videoId}-s0`, video_id: videoId,
    video_start: start, video_end: end, audio_start: audioStart, audio_end: audioEnd,
    reason: "",
  };
}

const AUDIO = "/test/audio.mp3";
const OUT = "/test/out.mp4";

describe("buildRendererArgs", () => {
  beforeEach(() => {
    mockExistsSync.mockReturnValue(false);
  });

  it("does not include -shortest flag", async () => {
    mockProbeVideo.mockResolvedValue(makeProbeResult(8));
    const result = await buildRendererArgs([pick("W001", 0, 8, 0, 8)], { W001: vid("W001") }, AUDIO, OUT);
    expect(result).not.toBeNull();
    expect(result!.args).not.toContain("-shortest");
  });

  it("appends -t <audioDuration> to clamp output length", async () => {
    mockProbeVideo.mockResolvedValue(makeProbeResult(12));
    const result = await buildRendererArgs([pick("W001", 0, 12, 0, 12)], { W001: vid("W001") }, AUDIO, OUT);
    expect(result).not.toBeNull();
    const args = result!.args;
    const lastT = args.lastIndexOf("-t");
    expect(args[lastT + 1]).toBe("12");
  });

  it("adds tpad freeze when video is shorter than audio by more than 0.04s", async () => {
    mockProbeVideo.mockResolvedValue(makeProbeResult(12)); // audio=12, video=8 → gap=4
    const result = await buildRendererArgs([pick("W001", 0, 8, 0, 8)], { W001: vid("W001") }, AUDIO, OUT);
    expect(result).not.toBeNull();
    const fcIdx = result!.args.indexOf("-filter_complex");
    const filterComplex = result!.args[fcIdx + 1];
    expect(filterComplex).toContain("tpad=stop_mode=clone:stop_duration=4");
  });

  it("skips tpad when drift is below 0.04s threshold", async () => {
    mockProbeVideo.mockResolvedValue(makeProbeResult(8.02)); // gap=0.02 < 0.04
    const result = await buildRendererArgs([pick("W001", 0, 8, 0, 8)], { W001: vid("W001") }, AUDIO, OUT);
    expect(result).not.toBeNull();
    const fcIdx = result!.args.indexOf("-filter_complex");
    const filterComplex = result!.args[fcIdx + 1];
    expect(filterComplex).not.toContain("tpad");
  });

  it("adds amix filter when bg music file exists", async () => {
    mockExistsSync.mockReturnValue(true);
    mockProbeVideo.mockResolvedValue(makeProbeResult(8));
    const result = await buildRendererArgs([pick("W001", 0, 8, 0, 8)], { W001: vid("W001") }, AUDIO, OUT);
    expect(result).not.toBeNull();
    const fcIdx = result!.args.indexOf("-filter_complex");
    const filterComplex = result!.args[fcIdx + 1];
    expect(filterComplex).toContain("amix=inputs=2");
  });

  it("handles two-clip timeline with 2x same source clip (no -shortest)", async () => {
    mockProbeVideo.mockResolvedValue(makeProbeResult(20));
    const timeline = [
      pick("W001", 0, 10, 0, 10),
      pick("W001", 0, 10, 10, 20), // same clip reused
    ];
    const result = await buildRendererArgs(timeline, { W001: vid("W001") }, AUDIO, OUT);
    expect(result).not.toBeNull();
    expect(result!.args).not.toContain("-shortest");
    expect(result!.inputFiles.filter((f) => f === "/videos/W001.mp4")).toHaveLength(2);
  });
});
