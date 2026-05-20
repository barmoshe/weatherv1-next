import fs from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { buildFcp7Xml, type Fcp7ClipPlacement, type Fcp7Input } from "@/server/export/fcp7-xml";
import type { ResolvedPick, Scene } from "@/shared/types";

function loadFixture(): {
  job_id: string;
  duration_sec: number;
  timeline: ResolvedPick[];
  scenes: Scene[];
} {
  const p = path.join(process.cwd(), "docs/fixtures/samples/forecast_fixture_demo_complete.plan.json");
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function placementsFromFixture(timeline: ResolvedPick[]): Fcp7ClipPlacement[] {
  return timeline.map((p) => ({
    fileId: `file-${p.video_id}`,
    name: `${p.video_id}.mp4`,
    pathUrl: `media/${p.video_id}.mp4`,
    width: 1920,
    height: 1080,
    fileDurationSec: 30,
    seqStartSec: p.audio_start,
    seqEndSec: p.audio_end,
    inSec: p.video_start,
    outSec: p.video_end,
    note: p.picker_reason ?? p.reason ?? "",
  }));
}

function baseInput(): Fcp7Input {
  const fx = loadFixture();
  return {
    jobId: fx.job_id,
    durationSec: fx.duration_sec,
    clips: placementsFromFixture(fx.timeline),
    scenes: fx.scenes,
    voiceover: { pathUrl: "media/voiceover.mp3", name: "voiceover.mp3", durationSec: fx.duration_sec },
    bgMusic: { pathUrl: "media/background-music.mp3", name: "background-music.mp3", durationSec: 5 },
  };
}

describe("buildFcp7Xml", () => {
  it("produces an XMEML v5 doc with DOCTYPE and a per-job sequence id", () => {
    const xml = buildFcp7Xml(baseInput());
    expect(xml).toContain("DOCTYPE xmeml");
    expect(xml).toContain('<xmeml version="5">');
    expect(xml).toContain('<sequence id="seq-forecast_fixture_demo_complete">');
  });

  it("maps placements to 30fps frame counts (planned in/out preserved)", () => {
    const xml = buildFcp7Xml(baseInput());
    // IB002: seq 6..11 → start 180 / end 330; source 0..5 → out 150.
    expect(xml).toContain("<start>180</start>");
    expect(xml).toContain("<end>330</end>");
    expect(xml).toContain("<out>150</out>");
    // sequence duration 16s → 480 frames.
    expect(xml).toContain("<duration>480</duration>");
  });

  it("uses relative co-located media paths and no absolute file:// URLs", () => {
    const xml = buildFcp7Xml(baseInput());
    expect(xml).not.toContain("file://");
    expect(xml).toContain("<pathurl>media/IB001.mp4</pathurl>");
    const pathUrls = xml.match(/<pathurl>/g) ?? [];
    // 3 unique clips + voiceover + bg music = 5.
    expect(pathUrls.length).toBe(5);
  });

  it("dedupes the file block for a reused clip id", () => {
    const input = baseInput();
    // Reuse IB001 for a second pick → still one <file> definition for it.
    input.clips = [
      ...input.clips,
      { ...input.clips[0], seqStartSec: 16, seqEndSec: 20 },
    ];
    const xml = buildFcp7Xml(input);
    const ib001Files = xml.match(/<file id="file-IB001">/g) ?? [];
    expect(ib001Files.length).toBe(1);
  });

  it("emits scene markers carrying Hebrew titles", () => {
    const xml = buildFcp7Xml(baseInput());
    expect(xml).toContain("<marker>");
    expect(xml).toContain("<name>מוקד חום במרכז</name>");
  });

  it("loops bg music to fill the timeline and applies the -16dB level filter", () => {
    const xml = buildFcp7Xml(baseInput());
    // 16s filled by a 5s loop → 4 clipitems (5+5+5+1).
    const bgmClips = xml.match(/id="bgm-\d+"/g) ?? [];
    expect(bgmClips.length).toBe(4);
    expect(xml).toContain("<effectid>audiolevels</effectid>");
    expect(xml).toContain("<value>0.158489</value>");
  });

  it("omits the bg music track when its duration is unknown", () => {
    const xml = buildFcp7Xml({ ...baseInput(), bgMusic: { pathUrl: "media/x.mp3", name: "x.mp3", durationSec: 0 } });
    expect(xml).not.toContain('id="bgm-0"');
  });

  it("omits the voiceover track when none is bundled", () => {
    const xml = buildFcp7Xml({ ...baseInput(), voiceover: null });
    expect(xml).not.toContain('id="vo-clip"');
  });

  it("uses the picker reason as the per-clip note", () => {
    const input = baseInput();
    input.clips = input.clips.map((c, i) => (i === 0 ? { ...c, note: "matched keyword מרכז" } : c));
    const xml = buildFcp7Xml(input);
    expect(xml).toContain("<mastercomment1>matched keyword מרכז</mastercomment1>");
  });
});
