// Browser build: there is no whisper.cpp binary; the engine is the in-page
// ASR worker (web/media/asr.ts), which is always present.

export interface WhisperBinaryResolution {
  path: string;
  source: "env" | "bundled" | "dev";
}

export function whisperBinaryName(): string {
  return "browser";
}

export function resolveWhisperBinary(): WhisperBinaryResolution {
  return { path: "browser", source: "bundled" };
}
