/**
 * FCP7 XML (XMEML v5) serializer for the "Export to Premiere" bundle.
 *
 * Pure (no I/O): consumes already-resolved clip placements + audio sources and
 * returns an XML string Premiere imports as a sequence. Path/media resolution
 * lives in the route + `media-bundle.ts`; this module only stringifies, which
 * keeps the timeline → element mapping reusable (e.g. a future OTIO emitter).
 *
 * Decisions (see docs/future/premiere/PLAN.md):
 *  - Fixed 1080×1920, 30 fps sequence; seconds → frames via Math.round(sec * 30).
 *  - Media references are RELATIVE, co-located bundle paths (e.g. "media/IB001.mp4")
 *    so an extracted self-contained zip relinks by filename in its own folder.
 *  - Voiceover on its own audio track; looped background music on a second track
 *    at -16 dB (parity with the ffmpeg renderer's amix level).
 *  - Scene boundaries as sequence markers; picker reason as per-clip notes.
 */

import { create } from "xmlbuilder2";
import type { Scene } from "@/shared/types";

type XmlNode = ReturnType<typeof create>;

const FPS = 30;
const SEQ_WIDTH = 1080;
const SEQ_HEIGHT = 1920;
/** -16 dB as a linear gain for the FCP7 audiolevels filter (matches renderer amix). */
const BG_MUSIC_GAIN = Math.pow(10, -16 / 20);

export interface Fcp7ClipPlacement {
  /** Shared id so repeated picks of the same bundled file collapse in the Project panel. */
  fileId: string;
  name: string;
  /** Relative, co-located bundle path, e.g. "media/IB001.mp4". */
  pathUrl: string;
  width: number;
  height: number;
  /** Full source duration of the bundled file (seconds). */
  fileDurationSec: number;
  seqStartSec: number;
  seqEndSec: number;
  /** Source in/out within the bundled file (seconds) — the AI-planned cut. */
  inSec: number;
  outSec: number;
  note?: string;
}

export interface Fcp7AudioSource {
  pathUrl: string;
  name: string;
  durationSec: number;
}

export interface Fcp7Input {
  jobId: string;
  durationSec: number;
  clips: Fcp7ClipPlacement[];
  scenes: Scene[];
  voiceover?: Fcp7AudioSource | null;
  bgMusic?: Fcp7AudioSource | null;
  fps?: number;
}

function appendRate(node: XmlNode, fps: number): void {
  node
    .ele("rate")
    .ele("timebase").txt(String(fps)).up()
    .ele("ntsc").txt("FALSE").up()
    .up();
}

function appendAudioLevelFilter(clip: XmlNode, gain: number): void {
  const effect = clip.ele("filter").ele("effect");
  effect.ele("name").txt("Audio Levels").up();
  effect.ele("effectid").txt("audiolevels").up();
  effect.ele("effectcategory").txt("audiolevels").up();
  effect.ele("effecttype").txt("audiolevels").up();
  effect.ele("mediatype").txt("audio").up();
  const param = effect.ele("parameter");
  param.ele("name").txt("Level").up();
  param.ele("parameterid").txt("level").up();
  param.ele("valuemin").txt("0").up();
  param.ele("valuemax").txt("3.98109").up();
  param.ele("value").txt(gain.toFixed(6)).up();
}

interface AudioClipSpec {
  id: string;
  name: string;
  pathUrl: string;
  fileId: string;
  startFrames: number;
  endFrames: number;
  inFrames: number;
  outFrames: number;
  fileDurationFrames: number;
  emitFile: boolean;
  levelGain?: number;
}

function appendAudioClip(track: XmlNode, spec: AudioClipSpec, fps: number): void {
  const clip = track.ele("clipitem", { id: spec.id });
  clip.ele("name").txt(spec.name).up();
  clip.ele("duration").txt(String(spec.outFrames - spec.inFrames)).up();
  appendRate(clip, fps);
  clip.ele("start").txt(String(spec.startFrames)).up();
  clip.ele("end").txt(String(spec.endFrames)).up();
  clip.ele("in").txt(String(spec.inFrames)).up();
  clip.ele("out").txt(String(spec.outFrames)).up();

  if (spec.emitFile) {
    const file = clip.ele("file", { id: spec.fileId });
    file.ele("name").txt(spec.name).up();
    file.ele("pathurl").txt(spec.pathUrl).up();
    appendRate(file, fps);
    file.ele("duration").txt(String(spec.fileDurationFrames)).up();
    file
      .ele("media")
      .ele("audio")
      .ele("samplecharacteristics")
      .ele("depth").txt("16").up()
      .ele("samplerate").txt("48000").up();
  } else {
    clip.ele("file", { id: spec.fileId }).up();
  }

  clip.ele("sourcetrack").ele("mediatype").txt("audio").up().ele("trackindex").txt("1").up();
  if (spec.levelGain != null) appendAudioLevelFilter(clip, spec.levelGain);
}

function appendVideoTrack(video: XmlNode, clips: Fcp7ClipPlacement[], fps: number): void {
  const f = (s: number) => Math.round(s * fps);
  const track = video.ele("track");
  const emitted = new Set<string>();

  clips.forEach((clip, i) => {
    const item = track.ele("clipitem", { id: `clip-${i}` });
    item.ele("name").txt(clip.name).up();
    item.ele("duration").txt(String(f(clip.outSec - clip.inSec))).up();
    appendRate(item, fps);
    item.ele("start").txt(String(f(clip.seqStartSec))).up();
    item.ele("end").txt(String(f(clip.seqEndSec))).up();
    item.ele("in").txt(String(f(clip.inSec))).up();
    item.ele("out").txt(String(f(clip.outSec))).up();

    if (!emitted.has(clip.fileId)) {
      emitted.add(clip.fileId);
      const file = item.ele("file", { id: clip.fileId });
      file.ele("name").txt(clip.name).up();
      file.ele("pathurl").txt(clip.pathUrl).up();
      appendRate(file, fps);
      file.ele("duration").txt(String(f(clip.fileDurationSec))).up();
      file
        .ele("media")
        .ele("video")
        .ele("samplecharacteristics")
        .ele("width").txt(String(clip.width)).up()
        .ele("height").txt(String(clip.height)).up();
    } else {
      item.ele("file", { id: clip.fileId }).up();
    }

    if (clip.note) item.ele("comments").ele("mastercomment1").txt(clip.note).up();
  });
}

function appendBgMusicTrack(audio: XmlNode, music: Fcp7AudioSource, totalSec: number, fps: number): void {
  const f = (s: number) => Math.round(s * fps);
  const track = audio.ele("track");
  let elapsed = 0;
  let idx = 0;
  // Repeated clipitems back-to-back to mirror the renderer's `-stream_loop -1`,
  // trimming the final loop to land exactly on the voiceover length.
  while (elapsed < totalSec - 1e-6) {
    const segLen = Math.min(music.durationSec, totalSec - elapsed);
    appendAudioClip(
      track,
      {
        id: `bgm-${idx}`,
        name: music.name,
        pathUrl: music.pathUrl,
        fileId: "file-bgmusic",
        startFrames: f(elapsed),
        endFrames: f(elapsed + segLen),
        inFrames: 0,
        outFrames: f(segLen),
        fileDurationFrames: f(music.durationSec),
        emitFile: idx === 0,
        levelGain: BG_MUSIC_GAIN,
      },
      fps,
    );
    elapsed += segLen;
    idx++;
  }
}

/** Serialize resolved clip placements to an FCP7 XML (XMEML v5) string. */
export function buildFcp7Xml(input: Fcp7Input): string {
  const fps = input.fps ?? FPS;
  const f = (s: number) => Math.round(s * fps);

  const root = create({ version: "1.0", encoding: "UTF-8" });
  root.dtd({ name: "xmeml" });

  const sequence = root.ele("xmeml", { version: "5" }).ele("sequence", {
    id: `seq-forecast_${input.jobId}`,
  });
  sequence.ele("name").txt(`forecast_${input.jobId}`).up();
  sequence.ele("duration").txt(String(f(input.durationSec))).up();
  appendRate(sequence, fps);

  const timecode = sequence.ele("timecode");
  appendRate(timecode, fps);
  timecode.ele("string").txt("00:00:00:00").up();
  timecode.ele("frame").txt("0").up();
  timecode.ele("displayformat").txt("NDF").up();

  const media = sequence.ele("media");

  const video = media.ele("video");
  const vFormat = video.ele("format").ele("samplecharacteristics");
  vFormat.ele("width").txt(String(SEQ_WIDTH)).up();
  vFormat.ele("height").txt(String(SEQ_HEIGHT)).up();
  vFormat.ele("pixelaspectratio").txt("square").up();
  appendRate(vFormat, fps);
  appendVideoTrack(video, input.clips, fps);

  const audio = media.ele("audio");
  if (input.voiceover) {
    appendAudioClip(
      audio.ele("track"),
      {
        id: "vo-clip",
        name: input.voiceover.name,
        pathUrl: input.voiceover.pathUrl,
        fileId: "file-voiceover",
        startFrames: 0,
        endFrames: f(input.durationSec),
        inFrames: 0,
        outFrames: f(input.durationSec),
        fileDurationFrames: f(input.voiceover.durationSec || input.durationSec),
        emitFile: true,
      },
      fps,
    );
  }
  if (input.bgMusic && input.bgMusic.durationSec > 0) {
    appendBgMusicTrack(audio, input.bgMusic, input.durationSec, fps);
  }

  for (const scene of input.scenes) {
    const marker = sequence.ele("marker");
    marker.ele("name").txt(scene.title_he ?? "").up();
    marker.ele("comment").txt(scene.narration ?? "").up();
    marker.ele("in").txt(String(f(scene.start_sec))).up();
    marker.ele("out").txt("-1").up();
  }

  return root.end({ prettyPrint: true });
}
