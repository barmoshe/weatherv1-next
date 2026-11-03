// Browser build: no child processes. A running render registers an abort
// function under its job id so Cancel (killProcess) still stops it.

export interface SpawnResult {
  code: number | null;
  stderr: string;
}

const running = new Map<string, () => void>();

export function registerProcess(id: string, abort: () => void): void {
  running.set(id, abort);
}

export function unregisterProcess(id: string): void {
  running.delete(id);
}

export function killProcess(id: string): void {
  running.get(id)?.();
  running.delete(id);
}

export function killAllProcesses(): void {
  for (const abort of running.values()) abort();
  running.clear();
}

export function spawnFFmpeg(): Promise<SpawnResult> {
  return Promise.reject(new Error("ffmpeg is not available in the browser build"));
}
