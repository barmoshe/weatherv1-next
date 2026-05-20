import {
  spawn,
  type ChildProcessWithoutNullStreams,
} from "node:child_process";

const STDERR_RING_SIZE = 200; // lines

export interface SpawnResult {
  code: number;
  stderrTail: string;
}

// Registry of active ffmpeg processes for cancellation
const activeProcesses = new Map<string, ChildProcessWithoutNullStreams>();

export function registerProcess(id: string, child: ChildProcessWithoutNullStreams): void {
  ensureShutdownReaper();
  activeProcesses.set(id, child);
}

// Reap in-flight ffmpeg renders on shutdown. Installed lazily the first time a
// render spawns — this path always runs when reaping matters, unlike
// `instrumentation.ts` register() which Next 16 skips under the packaged
// standalone server (see docs/ELECTRON.md). Without it, the Electron-managed
// Next child receiving SIGTERM would orphan ffmpeg, leaving it burning CPU
// after the app window closes.
let reaperInstalled = false;
function ensureShutdownReaper(): void {
  if (reaperInstalled) return;
  if (typeof process === "undefined" || typeof process.once !== "function") return;
  reaperInstalled = true;
  const onTerm = () => {
    try {
      killAllProcesses();
    } finally {
      process.exit(0);
    }
  };
  process.once("SIGTERM", onTerm);
  process.once("SIGINT", onTerm);
}

export function unregisterProcess(id: string): void {
  activeProcesses.delete(id);
}

export function killProcess(id: string): void {
  const child = activeProcesses.get(id);
  if (child) {
    try { child.kill("SIGKILL"); } catch { /* ignore */ }
    activeProcesses.delete(id);
  }
}

/** Kill every tracked ffmpeg child — used to reap renders on process shutdown
 * so they don't orphan when the Electron-managed Next child receives SIGTERM. */
export function killAllProcesses(): void {
  for (const id of [...activeProcesses.keys()]) killProcess(id);
}

export function spawnFFmpeg(
  ffmpegPath: string,
  args: string[],
  opts: {
    jobId?: string;
    timeoutMs?: number;
    onProgress?: (progress: number) => void;
  } = {}
): Promise<SpawnResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, args, { stdio: ["pipe", "pipe", "pipe"] });

    if (opts.jobId) registerProcess(opts.jobId, child);

    const stderrLines: string[] = [];
    let stdoutBuf = "";
    let durationSec = 0;

    child.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      const lines = text.split("\n");
      for (const line of lines) {
        stderrLines.push(line);
        if (stderrLines.length > STDERR_RING_SIZE) stderrLines.shift();

        // Parse duration from "Duration: HH:MM:SS.xx"
        const durMatch = line.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
        if (durMatch) {
          durationSec =
            parseInt(durMatch[1]) * 3600 +
            parseInt(durMatch[2]) * 60 +
            parseFloat(durMatch[3]);
        }

        // Parse progress from "time=HH:MM:SS.xx"
        if (opts.onProgress && durationSec > 0) {
          const timeMatch = line.match(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/);
          if (timeMatch) {
            const elapsed =
              parseInt(timeMatch[1]) * 3600 +
              parseInt(timeMatch[2]) * 60 +
              parseFloat(timeMatch[3]);
            opts.onProgress(Math.min(elapsed / durationSec, 1));
          }
        }
      }
    });

    let timedOut = false;
    let timer: NodeJS.Timeout | undefined;
    if (opts.timeoutMs) {
      timer = setTimeout(() => {
        timedOut = true;
        try { child.kill("SIGKILL"); } catch { /* ignore */ }
      }, opts.timeoutMs);
    }

    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      if (opts.jobId) unregisterProcess(opts.jobId);
      if (timedOut) {
        reject(new Error(`ffmpeg timed out after ${opts.timeoutMs}ms`));
      } else {
        resolve({ code: code ?? 1, stderrTail: stderrLines.slice(-30).join("\n") });
      }
    });

    child.on("error", (err) => {
      if (timer) clearTimeout(timer);
      if (opts.jobId) unregisterProcess(opts.jobId);
      reject(err);
    });
  });
}
