// render-bg, render-gfx, compose, qc. Fixed tools: the agent never writes ffmpeg itself.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { VERTICAL_FRAME_HEIGHT as VH, VERTICAL_FRAME_WIDTH as VW } from "@/server/ffmpeg/vertical-frame";
import { AGENT_DIR, FPS, WORKSPACE, fail, ffmpeg, frameAt, jobPaths, probeDuration, run, writeJson } from "../lib/job";
import { PLACES, placeKey, project } from "../lib/places";
import type { Plan } from "../lib/schema";
import { loadPicks, loadPlan } from "./basic";
import { contactSheet, loadSegments, posterFor } from "./catalog";

const GRADE = {
  clean: "eq=saturation=1.1:contrast=1.04",
  dim: "eq=saturation=0.95:contrast=1.02:brightness=-0.07",
  blur: "eq=saturation=0.9:brightness=-0.1,gblur=sigma=18",
};

async function pool<T>(items: T[], n: number, fn: (x: T, i: number) => Promise<void>) {
  let next = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (next < items.length) { const i = next++; await fn(items[i], i); } }));
}

export async function renderBg(dir: string) {
  const p = jobPaths(dir);
  const plan = loadPlan(dir), picks = loadPicks(dir);
  const segs = new Map(loadSegments().map((s) => [s.segment_id, s]));
  fs.mkdirSync(p.bgDir, { recursive: true });
  type Piece = { file: string; from: number; frames: number; speed: number; grade: string; drift: number; id: string };
  const pieces: Piece[] = [];
  for (const s of plan.scenes) {
    const list = picks.scenes[s.id];
    if (!list) fail(`picks.json has no entry for ${s.id}`, "run `picks validate`");
    const f0 = frameAt(s.start), f1 = frameAt(s.end);
    list.forEach((pk, i) => {
      const seg = segs.get(pk.segment_id)!;
      const a = f0 + Math.round(((f1 - f0) * i) / list.length), b = f0 + Math.round(((f1 - f0) * (i + 1)) / list.length);
      const from = pk.in ?? seg.start, need = (b - a) / FPS;
      pieces.push({ id: `${s.id}-${i}`, file: seg.file, from, frames: b - a, speed: Math.min(1, (seg.end - from) / need),
        grade: GRADE[s.bg.treatment], drift: (pieces.length % 2 ? -1 : 1) * 110 });
    });
  }
  const t0 = Date.now();
  await pool(pieces, Math.max(2, Math.floor(os.cpus().length / 3)), async (pc, i) => {
    const D = pc.frames / FPS;
    const vf = [
      `setpts=(PTS-STARTPTS)/${pc.speed.toFixed(4)}`, `fps=${FPS}`,
      `scale=${VW * 1.1}:${VH * 1.1}:force_original_aspect_ratio=increase:flags=lanczos`, `crop=${VW * 1.1}:${VH * 1.1}`,
      `crop=${VW}:${VH}:'(iw-ow)/2+(t/${D.toFixed(3)}-0.5)*${pc.drift}':'(ih-oh)/2'`, "setsar=1", pc.grade,
      "tpad=stop_mode=clone:stop=30", "format=yuv420p",
    ].join(",");
    await ffmpeg(["-ss", pc.from.toFixed(3), "-t", (D * pc.speed + 0.5).toFixed(3), "-i", pc.file, "-an", "-vf", vf,
      "-frames:v", String(pc.frames), "-r", String(FPS), "-c:v", "libx264", "-preset", "fast", "-crf", "16", path.join(p.bgDir, `${String(i).padStart(3, "0")}.mp4`)]);
    process.stdout.write(`  ${pc.id} ${pc.frames}f${pc.speed < 1 ? ` (slowed ${(1 / pc.speed).toFixed(2)}x)` : ""}\n`);
  });
  fs.writeFileSync(path.join(p.bgDir, "list.txt"), pieces.map((_, i) => `file '${String(i).padStart(3, "0")}.mp4'`).join("\n"));
  await ffmpeg(["-f", "concat", "-safe", "0", "-i", path.join(p.bgDir, "list.txt"), "-c", "copy", p.bg]);
  console.log(`✓ bg.mp4: ${pieces.length} pieces, ${frameAt(plan.duration)} frames, ${((Date.now() - t0) / 1000).toFixed(0)} s\n  next: render-gfx`);
}

/** Data the template needs beyond plan.json: map positions and catalog stills for city cards. */
async function templateData(dir: string, plan: Plan) {
  const p = jobPaths(dir);
  const picks = fs.existsSync(p.picks) ? loadPicks(dir) : { scenes: {}, cities: {} as Record<string, string> };
  const segs = new Map(loadSegments().map((s) => [s.segment_id, s]));
  const places: Record<string, [number, number]> = {};
  const cityImg: Record<string, string> = {};
  for (const s of plan.scenes) if (s.type === "cities") for (const c of s.data.cities) {
    const key = c.key ?? placeKey(c.name);
    if (!key) continue;
    c.key = key; // the template reads positions and stills by key
    places[key] = project(PLACES[key].lonlat);
    const segId = picks.cities[key];
    if (segId && segs.has(segId)) cityImg[key] = pathToFileURL(await posterFor(segs.get(segId)!, path.join(p.assets, `city-${segId}.jpg`))).href;
  }
  return { plan, places, cityImg };
}

async function openTemplate(data: unknown) {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ channel: "chrome" });
  const open = async () => {
    const pg = await browser.newPage({ viewport: { width: VW, height: VH }, deviceScaleFactor: 1 });
    await pg.addInitScript((d) => ((window as unknown as { __DATA: unknown }).__DATA = d), data);
    await pg.goto(pathToFileURL(path.join(AGENT_DIR, "gfx", "template.html")).href);
    await pg.evaluate(() => (window as unknown as { __ready: Promise<void> }).__ready);
    return pg;
  };
  return { browser, open };
}

export async function renderGfx(dir: string, at?: string) {
  const p = jobPaths(dir);
  const plan = loadPlan(dir);
  const { browser, open } = await openTemplate(await templateData(dir, plan));
  const seek = (pg: Awaited<ReturnType<typeof open>>, t: number) => pg.evaluate((t) => (window as unknown as { __seek: (t: number) => void }).__seek(t), t);

  if (at) { // preview: composite a few moments over the background (or grey) for review
    fs.mkdirSync(p.qcDir, { recursive: true });
    const pg = await open();
    const outs: string[] = [];
    for (const t of at.split(",").map(Number)) {
      const tag = t.toFixed(2).replace(".", "_");
      const gfx = path.join(p.qcDir, `gfx_${tag}.png`), out = path.join(p.qcDir, `preview_${tag}.jpg`);
      await seek(pg, t);
      await pg.screenshot({ path: gfx, omitBackground: true });
      const base = fs.existsSync(p.bg) ? ["-ss", t.toFixed(3), "-i", p.bg] : ["-f", "lavfi", "-i", `color=c=0x5a6470:s=${VW}x${VH}`];
      await ffmpeg([...base, "-i", gfx, "-filter_complex", "[0:v][1:v]overlay=0:0", "-frames:v", "1", "-q:v", "3", out]);
      outs.push(out);
    }
    await browser.close();
    const sheet = path.join(p.qcDir, `preview.jpg`);
    await contactSheet(outs, at.split(",").map((t) => `t=${t}`), sheet, Math.min(5, outs.length));
    console.log(`✓ preview: ${sheet}`);
    return;
  }

  fs.rmSync(p.frames, { recursive: true, force: true });
  fs.mkdirSync(p.frames, { recursive: true });
  const N = frameAt(plan.duration), workers = Number(process.env.WEATHER_AGENT_WORKERS ?? 6);
  const t0 = Date.now();
  let done = 0;
  await Promise.all(Array.from({ length: workers }, async (_, w) => {
    let pg = await open();
    for (let f = w; f < N; f += workers) {
      for (let k = 0; ; k++) {
        try {
          await seek(pg, f / FPS);
          await pg.screenshot({ path: path.join(p.frames, `f${String(f).padStart(5, "0")}.png`), omitBackground: true, timeout: 15000 });
          break;
        } catch (e) { if (k >= 2) throw e; await pg.close().catch(() => {}); pg = await open(); }
      }
      if (++done % 150 === 0) process.stdout.write(`\r  ${done}/${N} frames`);
    }
  }));
  await browser.close();
  console.log(`\n✓ frames: ${N} in ${((Date.now() - t0) / 1000).toFixed(0)} s\n  next: compose`);
}

export async function compose(dir: string) {
  const p = jobPaths(dir);
  const plan = loadPlan(dir);
  const D = (frameAt(plan.duration) / FPS).toFixed(3);
  const narr = await probeDuration(p.narration);
  const music = process.env.WEATHER_AGENT_MUSIC ?? path.join(WORKSPACE!, "music", "מוזיקת אנדר לתחזית.mp3");
  if (!fs.existsSync(p.bg)) fail("no bg.mp4", "run render-bg");
  if (!fs.existsSync(path.join(p.frames, "f00000.png"))) fail("no graphics frames", "run render-gfx");
  const hasMusic = fs.existsSync(music);
  const lift = narr.toFixed(2);
  // Two passes on purpose: mixing (loudnorm) in the same pass as the video encode deadlocked the
  // muxer near the end on ffmpeg 8.1 (stalled at 0% CPU). Audio first, to a WAV of exact length.
  const mix = path.join(p.dir, "mix.wav");
  const audioGraph = [
    `[0:a]aresample=48000,apad=whole_dur=${D}[nar]` /* the voice stays as recorded: mix + master only */,
    hasMusic
      ? `[1:a]aresample=48000,atrim=0:${D},asetpts=PTS-STARTPTS,volume='if(lt(t,${lift}),0.15,0.15+0.5*min(1,(t-${lift})/0.8))':eval=frame,afade=t=in:d=0.4,afade=t=out:st=${(Number(D) - 1.6).toFixed(2)}:d=1.6[mus];[nar][mus]amix=inputs=2:duration=first:normalize=0[mix]`
      : "[nar]anull[mix]",
    "[mix]loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000,alimiter=limit=0.84:level=false,aformat=channel_layouts=stereo[a]",
  ].join(";");
  const t0 = Date.now();
  await ffmpeg(["-i", p.narration, ...(hasMusic ? ["-stream_loop", "-1", "-i", music] : []),
    "-filter_complex", audioGraph, "-map", "[a]", "-t", D, "-c:a", "pcm_s16le", mix]);
  await ffmpeg([
    "-i", p.bg, "-framerate", String(FPS), "-i", path.join(p.frames, "f%05d.png"), "-i", mix,
    "-filter_complex", "[0:v][1:v]overlay=0:0:format=auto,format=yuv420p[v]", "-map", "[v]", "-map", "2:a", "-t", D,
    "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-maxrate", "14M", "-bufsize", "28M", "-profile:v", "high", "-level", "4.1", "-g", String(FPS), "-pix_fmt", "yuv420p", "-r", String(FPS),
    "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", p.final,
  ]);
  // Delivery copy for chat/social: capped at 3.3 Mbps so 72 s stays under 30 MB.
  await ffmpeg(["-i", p.final, "-c:v", "libx264", "-preset", "medium", "-b:v", "3300k", "-maxrate", "3300k", "-bufsize", "6600k",
    "-profile:v", "high", "-level", "4.1", "-g", String(FPS), "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", p.share]);
  console.log(`✓ final.mp4 + final-share.mp4 (${((Date.now() - t0) / 1000).toFixed(0)} s)${hasMusic ? "" : " · no music bed found"}\n  next: qc`);
}

export async function qc(dir: string) {
  const p = jobPaths(dir);
  const plan = loadPlan(dir);
  if (!fs.existsSync(p.final)) fail("no final.mp4", "run compose");
  fs.mkdirSync(p.qcDir, { recursive: true });
  const moments: Array<[string, number]> = [];
  for (const s of plan.scenes) {
    moments.push([`${s.id} in`, Math.min(s.end - 0.05, s.start + 0.45)]);
    moments.push([`${s.id} mid`, (s.start + s.end) / 2]);
    if (s.end - s.start > 6) moments.push([`${s.id} late`, s.end - 0.6]);
  }
  const shots: string[] = [];
  await pool(moments, 6, async ([label, t], i) => {
    const out = path.join(p.qcDir, `qc_${String(i).padStart(2, "0")}.jpg`);
    await ffmpeg(["-ss", t.toFixed(3), "-i", p.final, "-frames:v", "1", "-vf", "scale=540:960", "-q:v", "3", out]);
    shots[i] = out;
  });
  const sheet = path.join(p.qcDir, "qc.jpg");
  await contactSheet(shots, moments.map(([l, t]) => `${l} · ${t.toFixed(1)}s`), sheet, 6);

  const loud = await run("ffmpeg", ["-nostdin", "-i", p.final, "-af", "ebur128=peak=true", "-f", "null", "-"], { quiet: true });
  const I = Number(/I:\s+(-?[\d.]+) LUFS/.exec(loud.split("Summary:").pop() ?? "")?.[1]);
  const peak = Number(/Peak:\s+(-?[\d.]+) dBFS/.exec(loud.split("Summary:").pop() ?? "")?.[1]);
  const black = await run("ffmpeg", ["-nostdin", "-i", p.final, "-vf", "blackdetect=d=0.1:pix_th=0.06", "-an", "-f", "null", "-"], { quiet: true });
  const blacks = [...black.matchAll(/black_start:([\d.]+) black_end:([\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
  const dur = await probeDuration(p.final);
  // A broken AAC track probes fine and only fails on decode: decode it and compare lengths.
  const dec = await run("ffmpeg", ["-nostdin", "-i", p.final, "-vn", "-f", "null", "-"], { quiet: true });
  const audioDur = [...dec.matchAll(/time=(\d+):(\d+):([\d.]+)/g)].map((m) => +m[1] * 3600 + +m[2] * 60 + +m[3]).pop() ?? 0;
  const issues: string[] = [];
  if (Math.abs(dur - plan.duration) > 0.1) issues.push(`duration ${dur.toFixed(2)} vs plan ${plan.duration}`);
  if (!(I > -15.5 && I < -12.5)) issues.push(`loudness ${I} LUFS (target -14)`);
  if (peak > -0.5) issues.push(`peak ${peak} dBFS`);
  if (Math.abs(audioDur - dur) > 0.15) issues.push(`decoded audio is ${audioDur.toFixed(2)} s, video ${dur.toFixed(2)} s`);
  if (fs.existsSync(p.share) && fs.statSync(p.share).size > 30e6) issues.push("final-share.mp4 is over 30 MB");
  for (const [a, b] of blacks) issues.push(`black frames ${a.toFixed(2)}-${b.toFixed(2)}`);
  const size = fs.statSync(p.final).size / 1e6;
  writeJson(path.join(p.qcDir, "qc.json"), { duration: dur, audio_decoded: audioDur, loudness_lufs: I, peak_dbfs: peak, black: blacks, size_mb: +size.toFixed(1), moments: moments.map(([l, t], i) => ({ i, label: l, t })), issues });
  console.log(`${issues.length ? "✗" : "✓"} qc: ${dur.toFixed(2)} s · ${I} LUFS · peak ${peak} dBFS · ${size.toFixed(0)} MB${issues.length ? `\n  ${issues.join("\n  ")}` : ""}\n  sheet: ${sheet}\n  next: look at the sheet; fix plan/picks and re-render (max 2 rounds)`);
}
