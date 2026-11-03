// Browser build: Chrome plays the library's H.264 files directly, so the
// preview is the source file itself (no transcode pass).
export function previewPath(vidId: string, previewsDir: string): string {
  return `${previewsDir}/${vidId}.mp4`;
}
export async function needsTranscode(): Promise<boolean> {
  return false;
}
export async function getPreviewPath(videoPath: string): Promise<string> {
  return videoPath;
}
