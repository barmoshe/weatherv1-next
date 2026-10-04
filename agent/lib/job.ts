// Shared plumbing for the agent CLI: job-folder paths, JSON IO, ffmpeg/ffprobe via spawn.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const FPS = 30;
export const W = 1080;
export const H = 1920;
export const AGENT_DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

// The catalog lives outside the repo. Default to Bar's local workspace, overridable.
process.env.WEATHER_WORKSPACE_DIR ??= path.join(os.homedir(), "v1Drive", "weather");
export const WORKSPACE = process.env.WEATHER_WORKSPACE_DIR;

/** Every file a run reads or writes, relative to one job folder (outside the repo). */
export function jobPaths(dir: string) {
  const d = path.resolve(dir);
  return {
    dir: d,
    narration: findNarration(d),
    transcript: path.join(d, "transcript.json"),
    fixed: path.join(d, "transcript.fixed.json"),
    plan: path.join(d, "plan.json"),
    picks: path.join(d, "picks.json"),
    search: path.join(d, "search"),
    assets: path.join(d, "assets"),
    frames: path.join(d, "frames"),
    bgDir: path.join(d, "bg"),
    bg: path.join(d, "bg.mp4"),
    final: path.join(d, "final.mp4"),
    share: path.join(d, "final-share.mp4"),
    qcDir: path.join(d, "qc"),
    report: path.join(d, "report.md"),
  };
}

function findNarration(dir: string): string {
  if (!fs.existsSync(dir)) return path.join(dir, "narration.mp3");
  const f = fs.readdirSync(dir).find((n) => /^narration\.(mp3|m4a|wav|ogg|opus|aac)$/i.test(n));
  return path.join(dir, f ?? "narration.mp3");
}

export function readJson<T = unknown>(file: string): T {
  if (!fs.existsSync(file)) fail(`missing ${path.basename(file)} (${file})`);
  return JSON.parse(fs.readFileSync(file, "utf8")) as T;
}

export function writeJson(file: string, data: unknown) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 1) + "\n");
}

/** Exit with an error that says what to do next. */
export function fail(msg: string, next?: string): never {
  console.error(`✗ ${msg}${next ? `\n  next: ${next}` : ""}`);
  process.exit(1);
}

export function run(cmd: string, args: string[], opts: { quiet?: boolean; input?: NodeJS.ReadableStream } = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ["pipe", "pipe", "pipe"] });
    let out = "", err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => { err += d; if (!opts.quiet && cmd !== "ffmpeg") process.stderr.write(d); });
    p.stdin.end();
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve(out + err) : reject(new Error(`${cmd} exited ${code}\n${err.slice(-2000)}`))));
  });
}

export const ffmpeg = (args: string[]) => run("ffmpeg", ["-y", "-nostdin", "-loglevel", "error", ...args], { quiet: true });

export async function probeDuration(file: string): Promise<number> {
  const out = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file], { quiet: true });
  return Number(out.trim());
}

/** Frame index for a time, so every cut lands on the same frame in every tool. */
export const frameAt = (t: number) => Math.round(t * FPS);
