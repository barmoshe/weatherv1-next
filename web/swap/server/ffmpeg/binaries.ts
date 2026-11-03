// Browser build: no ffmpeg binary; media work runs on WebCodecs (web/media/).
export function getFFmpegPath(): string {
  return "browser";
}
export function getFFprobePath(): string {
  return "browser";
}
export function verifyFFmpegAtBoot(): void {
  // nothing to verify: WebCodecs support is checked by the start-up gate
}
