// doctor, transcribe, plan validate, picks validate.
import fs from "node:fs";
import path from "node:path";
import { AGENT_DIR, WORKSPACE, fail, jobPaths, probeDuration, readJson, run } from "../lib/job";
import { PlanSchema, PicksSchema, WordsSchema, sceneCues, type Plan } from "../lib/schema";
import { placeKey } from "../lib/places";
import { WHISPER_HE_PROMPT } from "@/server/pipeline/transcript-fixes";
import { clothingClimateMismatch } from "@/server/pipeline/beat-tagger";
import { loadSegments } from "./catalog";

const PY = process.env.WEATHER_AGENT_PYTHON ?? "python3";
const MODEL = process.env.WEATHER_AGENT_WHISPER ?? "medium";

export async function doctor() {
  const checks: Array<[string, () => Promise<string>]> = [
    ["ffmpeg", async () => (await run("ffmpeg", ["-version"], { quiet: true })).split("\n")[0]],
    ["ffprobe", async () => (await run("ffprobe", ["-version"], { quiet: true })).split("\n")[0]],
    ["chrome (playwright channel)", async () => {
      const { chromium } = await import("playwright");
      const b = await chromium.launch({ channel: "chrome" }); const v = b.version(); await b.close(); return v;
    }],
    [`whisper (${PY})`, async () => (await run(PY, ["-c", "import whisper, numpy; print('whisper ok, numpy', numpy.__version__)"], { quiet: true })).trim()],
    [`whisper model ${MODEL}`, async () => {
      const f = path.join(process.env.HOME ?? "", ".cache", "whisper", `${MODEL}.pt`);
      if (!fs.existsSync(f)) throw new Error(`${f} not cached; the first transcribe will download it`);
      return f;
    }],
    ["catalog", async () => {
      const segs = loadSegments();
      const local = segs.filter((s) => s.available).length;
      return `${WORKSPACE}: ${segs.length} segments, ${local} with a local file`;
    }],
  ];
  let bad = 0;
  for (const [name, fn] of checks) {
    try { console.log(`✓ ${name}: ${await fn()}`); }
    catch (e) {
      bad++;
      const msg = String((e as Error).message).split("\n").slice(-3).join(" ");
      console.log(`✗ ${name}: ${msg}`);
      if (name.startsWith("whisper (") && /numpy|NumPy|numba/.test(msg))
        console.log(`  next: python3 -m venv --system-site-packages ~/.v1-agent-venv && ~/.v1-agent-venv/bin/pip install "numpy<2" openai-whisper, then WEATHER_AGENT_PYTHON=~/.v1-agent-venv/bin/python`);
    }
  }
  if (bad) process.exit(1);
}

export async function transcribe(dir: string) {
  const p = jobPaths(dir);
  if (!fs.existsSync(p.narration)) fail(`no narration in ${p.dir}`, "copy the recording to <job>/narration.mp3 (or .m4a/.wav)");
  const t0 = Date.now();
  await run(PY, [path.join(AGENT_DIR, "tools", "transcribe.py"), p.narration, p.transcript, MODEL, WHISPER_HE_PROMPT]);
  const tr = readJson<{ words: unknown[]; segments: Array<{ start: number; end: number; text: string }> }>(p.transcript);
  for (const s of tr.segments) console.log(`${s.start.toFixed(2).padStart(6)}  ${s.text}`);
  console.log(`✓ transcript.json (${tr.words.length} words, ${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  console.log("  next: write transcript.fixed.json (same words, corrected by meaning; mark unrecoverable words unresolved)");
}

export async function align(dir: string) {
  const p = jobPaths(dir);
  if (!fs.existsSync(p.fixed)) fail("no transcript.fixed.json", "correct the transcript first");
  if (!fs.existsSync(p.plan)) fail("no plan.json", "write the plan on Whisper's clock first; align moves it onto the voice");
  const t0 = Date.now();
  await run(PY, [path.join(AGENT_DIR, "tools", "align.py"), p.dir]);
  console.log(`✓ aligned (${((Date.now() - t0) / 1000).toFixed(0)} s); plan.whisper.json keeps the Whisper-clock plan\n  next: plan-validate, then render-bg (scene boundaries moved)`);
}

function loadWords(dir: string) {
  const p = jobPaths(dir);
  const r = WordsSchema.safeParse(readJson(p.fixed));
  if (!r.success) fail(`transcript.fixed.json: ${r.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`);
  return r.data;
}

export function loadPlan(dir: string): Plan {
  const r = PlanSchema.safeParse(readJson(jobPaths(dir).plan));
  if (!r.success) fail(`plan.json schema: ${r.error.issues.slice(0, 8).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  return r.data;
}

export async function planValidate(dir: string) {
  const p = jobPaths(dir);
  const plan = loadPlan(dir);
  const words = loadWords(dir).words;
  const audio = await probeDuration(p.narration);
  const errors: string[] = [], warns: string[] = [];
  const total = audio + plan.tail;
  if (Math.abs(plan.duration - total) > 0.05) errors.push(`duration ${plan.duration} must equal narration ${audio.toFixed(2)} + tail ${plan.tail} = ${total.toFixed(2)}`);

  // Scenes tile the timeline with no gaps or overlaps.
  plan.scenes.forEach((s, i) => {
    const prevEnd = i ? plan.scenes[i - 1].end : 0;
    if (Math.abs(s.start - prevEnd) > 0.001) errors.push(`${s.id}.start ${s.start} must equal the previous end ${prevEnd}`);
    if (s.end - s.start < 1.2) errors.push(`${s.id} is ${(s.end - s.start).toFixed(2)} s; scenes need ≥ 1.2 s`);
  });
  const last = plan.scenes.at(-1)!;
  if (Math.abs(last.end - plan.duration) > 0.05) errors.push(`last scene ends ${last.end}, plan.duration is ${plan.duration}`);
  if (new Set(plan.scenes.map((s) => s.id)).size !== plan.scenes.length) errors.push("scene ids must be unique");

  // Every cue lands on a word start and inside its scene.
  const starts = words.filter((w) => !w.unresolved).map((w) => w.start);
  const onWord = (t: number) => starts.some((s) => Math.abs(s - t) <= 0.06);
  for (const s of plan.scenes) {
    if (s.type !== "intro" && s.type !== "outro" && s.start > 0 && s.start < audio && !onWord(s.start))
      warns.push(`${s.id}.start ${s.start} is not on a word start (cuts read best on a word)`);
    for (const c of sceneCues(s)) {
      if (c.at < s.start - 0.001 || c.at >= s.end) errors.push(`${c.label}=${c.at} is outside ${s.id} [${s.start}, ${s.end})`);
      else if (c.at < audio && !onWord(c.at)) errors.push(`${c.label}=${c.at} is not a word start (nearest: ${nearest(starts, c.at)})`);
    }
    if (s.type === "cities") for (const c of s.data.cities) if (!(c.key ?? placeKey(c.name))) warns.push(`${s.id}: no map position for "${c.name}" (card shows without a dot); add it to agent/lib/places.ts`);
  }

  // Captions: in order, inside the audio, starting on words, never quoting an unresolved word.
  const unresolved = new Set(words.filter((w) => w.unresolved).map((w) => w.w));
  plan.captions.forEach((c, i) => {
    if (c.end <= c.start) errors.push(`caption ${i} "${c.text}" ends before it starts`);
    if (i && c.start < plan.captions[i - 1].end - 0.001) errors.push(`caption ${i} "${c.text}" overlaps the previous one`);
    if (!(i === 0 && c.start === 0) && !onWord(c.start)) errors.push(`caption ${i} "${c.text}" starts at ${c.start}, not a word start (nearest: ${nearest(starts, c.start)})`);
    for (const u of unresolved) if (c.text.includes(u)) errors.push(`caption ${i} quotes the unresolved word "${u}"`);
  });

  report("plan.json", errors, warns, "picks: run `catalog search` for each scene, then write picks.json");
}

function nearest(starts: number[], t: number) {
  return starts.reduce((a, b) => (Math.abs(b - t) < Math.abs(a - t) ? b : a), starts[0]);
}

export function loadPicks(dir: string) {
  const r = PicksSchema.safeParse(readJson(jobPaths(dir).picks));
  if (!r.success) fail(`picks.json schema: ${r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  return r.data;
}

export async function picksValidate(dir: string) {
  const plan = loadPlan(dir);
  const picks = loadPicks(dir);
  const segs = new Map(loadSegments().map((s) => [s.segment_id, s]));
  const errors: string[] = [], warns: string[] = [];
  const used = new Map<string, string>();
  for (const s of plan.scenes) {
    const list = picks.scenes[s.id];
    if (!list) { errors.push(`${s.id}: no picks`); continue; }
    const need = (s.end - s.start) / list.length;
    for (const pk of list) {
      const seg = segs.get(pk.segment_id);
      if (!seg) { errors.push(`${s.id}: ${pk.segment_id} is not in the catalog`); continue; }
      if (!seg.available) errors.push(`${s.id}: ${pk.segment_id} has no local file (${seg.file})`);
      if (used.has(pk.segment_id)) errors.push(`${s.id}: ${pk.segment_id} is already used by ${used.get(pk.segment_id)}`);
      used.set(pk.segment_id, s.id);
      const from = pk.in ?? seg.start;
      if (from < seg.start || from >= seg.end) errors.push(`${s.id}: in=${from} is outside ${pk.segment_id} [${seg.start}, ${seg.end}]`);
      const avail = seg.end - from;
      if (avail < need / 1.5) errors.push(`${s.id}: ${pk.segment_id} has ${avail.toFixed(1)} s from in=${from}, the scene needs ${need.toFixed(1)} s (max slow-down 1.5x)`);
      else if (avail < need) warns.push(`${s.id}: ${pk.segment_id} will be slowed to ${(need / avail).toFixed(2)}x to fill ${need.toFixed(1)} s`);
      const sceneText = narrationOf(dir, s.start, s.end);
      if (clothingClimateMismatch(sceneText, seg.text)) errors.push(`${s.id}: ${pk.segment_id} shows clothing for the wrong weather ("${seg.description.slice(0, 60)}")`);
    }
  }
  for (const [city, segId] of Object.entries(picks.cities)) {
    if (!segs.has(segId)) errors.push(`cities.${city}: ${segId} is not in the catalog`);
  }
  report("picks.json", errors, warns, "render: `render-bg`, `render-gfx`, then `compose`");
}

function narrationOf(dir: string, a: number, b: number) {
  return loadWords(dir).words.filter((w) => w.start >= a && w.start < b).map((w) => w.w).join(" ");
}

function report(what: string, errors: string[], warns: string[], next: string) {
  for (const w of warns) console.log(`! ${w}`);
  if (errors.length) {
    for (const e of errors) console.log(`✗ ${e}`);
    fail(`${what}: ${errors.length} error(s)`, "fix the file and run the validator again");
  }
  console.log(`✓ ${what} valid${warns.length ? ` (${warns.length} warning(s))` : ""}\n  next: ${next}`);
}
