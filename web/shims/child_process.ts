// `node:child_process` for the browser build. Every caller (ffmpeg, ffprobe,
// whisper.cpp) is swapped for a browser module; reaching this is a bug.
function unavailable(): never {
  throw new Error("child_process is not available in the browser build");
}
export const spawn = unavailable;
export const execFile = unavailable;
export const execFileSync = unavailable;
export default { spawn, execFile, execFileSync };
