// What this browser can do, checked before anything loads. Missing a
// required feature means the app can't work here at all (wrong browser);
// WebGPU only makes transcription slower when missing.

export interface Capabilities {
  folderAccess: boolean;
  videoEncode: boolean;
  audioEncode: boolean;
  webgpu: boolean;
  browser: string;
}

export async function detectCapabilities(): Promise<Capabilities> {
  const folderAccess = typeof window.showDirectoryPicker === "function";
  let videoEncode = false;
  let audioEncode = false;
  try {
    videoEncode = Boolean(
      (await VideoEncoder.isConfigSupported({ codec: "avc1.640028", width: 1080, height: 1920, bitrate: 8e6, framerate: 30 }))
        .supported,
    );
  } catch {
    videoEncode = false;
  }
  try {
    audioEncode = Boolean(
      (await AudioEncoder.isConfigSupported({ codec: "mp4a.40.2", sampleRate: 48000, numberOfChannels: 2, bitrate: 128000 }))
        .supported,
    );
  } catch {
    audioEncode = false;
  }
  let webgpu = false;
  try {
    webgpu = Boolean(await (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu?.requestAdapter());
  } catch {
    webgpu = false;
  }
  const browser = navigator.userAgent.match(/(Edg|Chrome)\/[\d.]+/)?.[0] ?? navigator.userAgent;
  return { folderAccess, videoEncode, audioEncode, webgpu, browser };
}

/** Required to run at all. AAC has a WASM fallback, so it isn't required. */
export function missingRequired(c: Capabilities): string[] {
  const missing: string[] = [];
  if (!c.folderAccess) missing.push("גישה לתיקיות");
  if (!c.videoEncode) missing.push("קידוד וידאו H.264");
  return missing;
}
