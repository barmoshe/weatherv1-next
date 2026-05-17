export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { pullJobsFromR2 } = await import("@/server/sync/r2/service");
  await pullJobsFromR2();

  const { startWorker } = await import("@/server/jobs/worker");
  startWorker();

  // Drain any R2 mirror ops left in `r2-sync-state.json` from a prior process.
  const { kickMirrorQueue } = await import("@/server/sync/r2/mirror-queue");
  kickMirrorQueue();

  // Soft parity check for `next dev` only. The authoritative ffmpeg gate is
  // `electron/ffmpeg-verify.cjs`, called from Electron main before the Next
  // child is spawned. Under `node .next/standalone/server.js` this
  // instrumentation hook is not reliably executed (vercel/next.js#89377), so
  // we never throw here — the worst case is a clear error at the first
  // render request, which the soft warning surfaces in advance.
  if (process.env.DESKTOP_MODE !== "1") {
    try {
      const { verifyFFmpegAtBoot } = await import("@/server/ffmpeg/binaries");
      verifyFFmpegAtBoot();
    } catch (err) {
      console.warn(
        "[instrumentation] ffmpeg/ffprobe verification failed (soft warning, render endpoints will error at first use):",
        err instanceof Error ? err.message : String(err),
      );
    }
  }
}
