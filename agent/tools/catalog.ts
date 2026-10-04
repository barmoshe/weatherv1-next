// `catalog search`: the app's own retrieval (BM25 + concepts + mood/clothing gates) for one scene,
// plus a numbered contact sheet of the candidates so the agent picks by eye.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseCatalog } from "@/server/catalog/parser";
import { retrieveCandidates } from "@/server/pipeline/retrieve";
import { VERTICAL_SCALE_CROP_FILTER } from "@/server/ffmpeg/vertical-frame";
import type { Scene } from "@/shared/types";
import { fail, ffmpeg, jobPaths, readJson, writeJson } from "../lib/job";
import { loadPlan } from "./basic";
import type { Words } from "../lib/schema";

export interface Seg {
  segment_id: string; clip_id: string; file: string; available: boolean;
  start: number; end: number; description: string; tags: string[]; orientation: string; text: string;
}

let _segs: Seg[] | null = null;
export function loadSegments(): Seg[] {
  if (_segs) return _segs;
  const log = console.log; console.log = () => {}; // parseCatalog logs a health line per call
  const videos = parseCatalog();
  console.log = log;
  _segs = videos.flatMap((v) => v.segments.map((s) => ({
    segment_id: s.id, clip_id: v.id, file: v.path, available: v.availability === "local",
    start: Number(s.start_sec ?? 0), end: Number(s.end_sec ?? v.duration_sec ?? 0),
    description: s.description ?? "", tags: (s.tags as string[]) ?? [], orientation: String(v.orientation ?? ""),
    text: [s.description ?? "", ...((s.tags as string[]) ?? [])].join(" "),
  })));
  return _segs;
}

export async function posterFor(seg: Seg, out: string, at?: number) {
  if (fs.existsSync(out)) return out;
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const t = at ?? seg.start + Math.min(1.5, (seg.end - seg.start) / 2);
  await ffmpeg(["-ss", t.toFixed(2), "-i", seg.file, "-frames:v", "1", "-vf", `${VERTICAL_SCALE_CROP_FILTER},scale=540:960`, "-q:v", "3", out]);
  return out;
}

export async function search(dir: string, sceneId: string, k = 12) {
  const p = jobPaths(dir);
  const plan = loadPlan(dir);
  const s = plan.scenes.find((x) => x.id === sceneId);
  if (!s) fail(`no scene "${sceneId}"`, `one of: ${plan.scenes.map((x) => x.id).join(", ")}`);
  const words = fs.existsSync(p.fixed) ? readJson<Words>(p.fixed).words : [];
  const narration = words.filter((w) => w.start >= s.start && w.start < s.end).map((w) => w.w).join(" ");
  const taken = new Set<string>();
  if (fs.existsSync(p.picks)) {
    const picks = readJson<{ scenes: Record<string, Array<{ segment_id: string }>> }>(p.picks);
    for (const [sid, list] of Object.entries(picks.scenes ?? {})) if (sid !== sceneId) list.forEach((x) => taken.add(x.segment_id));
  }

  const scene: Scene = {
    idx: plan.scenes.indexOf(s), start_sec: s.start, end_sec: s.end, title_he: s.bg.query,
    narration: `${s.bg.query} ${narration}`, keywords: s.bg.keywords, mood: s.bg.mood, kind: "prose",
    heterogeneous: false, whisper_beat_indices: [],
    desired_concepts: s.bg.concepts as Scene["desired_concepts"], desired_keywords: s.bg.keywords,
  };
  const segs = new Map(loadSegments().map((x) => [x.segment_id, x]));
  // The app tier-shuffles its shortlist (variety for its picker LLM), so a small k is close to random
  // among the top quintile. Keep its scoring and gates, but rank strictly by score, plus a boost for a
  // segment whose own description names one of the scene's keywords.
  const { shortlist, shortlist_thin } = retrieveCandidates(scene, parseQuiet(), { renderSeed: 7, k: 10_000 });
  const boost = (desc: string) => s.bg.keywords.filter((kw) => desc.includes(kw)).length * 2;
  const list = shortlist
    .filter((c) => !taken.has(c.segment_id) && segs.get(c.segment_id)?.available)
    .map((c) => ({ ...c, score: Math.round((c.score + boost(c.description)) * 100) / 100 }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
  if (!list.length) fail(`no candidates for ${sceneId}`, "broaden bg.query / bg.keywords, or drop bg.mood");

  const posters = await Promise.all(list.map((c) => posterFor(segs.get(c.segment_id)!, path.join(p.search, "posters", `${c.segment_id}.jpg`))));
  const sheet = path.join(p.search, `${sceneId}.jpg`);
  await contactSheet(posters, list.map((c, i) => `${i + 1} · ${c.segment_id} · ${c.duration.toFixed(0)}s`), sheet);
  const out = list.map((c, i) => ({ n: i + 1, segment_id: c.segment_id, duration: c.duration, orientation: c.orientation, score: c.score, tags: c.tags.slice(0, 8), description: c.description }));
  writeJson(path.join(p.search, `${sceneId}.json`), { scene: sceneId, need_sec: +(s.end - s.start).toFixed(2), thin: shortlist_thin, candidates: out });
  for (const c of out) console.log(`${String(c.n).padStart(2)}. ${c.segment_id.padEnd(10)} ${c.duration.toFixed(1).padStart(5)}s ${c.orientation}  ${c.description.slice(0, 110)}`);
  console.log(`✓ ${list.length} candidates for ${sceneId} (needs ${(s.end - s.start).toFixed(1)} s)${shortlist_thin ? " · thin shortlist" : ""}\n  sheet: ${sheet}`);
}

function parseQuiet() {
  const log = console.log; console.log = () => {};
  try { return parseCatalog(); } finally { console.log = log; }
}

/** Numbered poster grid rendered with Chromium (ffmpeg here has no drawtext). */
export async function contactSheet(images: string[], labels: string[], out: string, cols = 4) {
  const { chromium } = await import("playwright");
  const b = await chromium.launch({ channel: "chrome" });
  const pg = await b.newPage({ viewport: { width: cols * 270, height: 600 } });
  const cells = images.map((img, i) => `<figure><img src="${pathToFileURL(img).href}"><figcaption>${labels[i]}</figcaption></figure>`).join("");
  // A file:// page, so the browser may load the file:// posters (about:blank may not).
  const html = `${out}.html`;
  fs.writeFileSync(html, `<meta charset="utf-8"><style>body{margin:0;background:#111;display:grid;grid-template-columns:repeat(${cols},270px)}
    figure{margin:0;position:relative;height:480px}img{width:270px;height:480px;object-fit:cover;display:block}
    figcaption{position:absolute;left:0;right:0;bottom:0;background:rgba(0,0,0,.72);color:#fff;font:700 17px/1.2 Menlo,monospace;padding:7px 8px}</style>${cells}`);
  await pg.goto(pathToFileURL(html).href);
  await pg.evaluate(() => Promise.all([...document.images].map((i) => (i.complete ? 1 : new Promise((r) => (i.onload = i.onerror = r))))));
  await pg.screenshot({ path: out, fullPage: true, type: "jpeg", quality: 82 });
  fs.rmSync(html, { force: true });
  await b.close();
}
