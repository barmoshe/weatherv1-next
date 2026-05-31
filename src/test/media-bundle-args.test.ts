import { describe, it, expect } from "vitest";
import { buildExtractSegmentArgs } from "@/server/export/media-bundle";
import { VERTICAL_SCALE_CROP_FILTER } from "@/server/ffmpeg/vertical-frame";

/**
 * Regression test for the 2026-05-29 "Premiere clips don't fill the 9:16 frame"
 * fix. The bundled segments must go through the same scale/crop the renderer
 * uses, or they import as a small letterboxed band in Premiere.
 */
describe("buildExtractSegmentArgs", () => {
  const args = buildExtractSegmentArgs("/in/clip.mp4", "/out/seg.mp4", 12.345, 6.789);

  it("seeks before -i so re-encode lands on the exact frame", () => {
    const ssIdx = args.indexOf("-ss");
    const iIdx = args.indexOf("-i");
    expect(ssIdx).toBeGreaterThanOrEqual(0);
    expect(iIdx).toBeGreaterThan(ssIdx);
    expect(args[ssIdx + 1]).toBe("12.345");
    expect(args[iIdx + 1]).toBe("/in/clip.mp4");
  });

  it("trims to the requested duration", () => {
    const tIdx = args.indexOf("-t");
    expect(tIdx).toBeGreaterThanOrEqual(0);
    expect(args[tIdx + 1]).toBe("6.789");
  });

  it("applies the shared 9:16 cover-crop filter (parity with the renderer)", () => {
    const vfIdx = args.indexOf("-vf");
    expect(vfIdx).toBeGreaterThanOrEqual(0);
    expect(args[vfIdx + 1]).toBe(VERTICAL_SCALE_CROP_FILTER);
  });

  it("drops audio, encodes libx264 / yuv420p, and overwrites the output", () => {
    expect(args).toContain("-an");
    const vcodec = args.indexOf("-vcodec");
    expect(args[vcodec + 1]).toBe("libx264");
    const pix = args.indexOf("-pix_fmt");
    expect(args[pix + 1]).toBe("yuv420p");
    expect(args).toContain("-y");
    expect(args[args.length - 1]).toBe("/out/seg.mp4");
  });
});
