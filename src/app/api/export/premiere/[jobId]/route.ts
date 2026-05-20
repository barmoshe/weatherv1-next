import fs from "node:fs";
import { Readable } from "node:stream";
import { createRequire } from "node:module";
import { NextRequest, NextResponse } from "next/server";
import { assertDesktopAuth } from "@/server/runtime/auth";
import { hydratePlanBundleFromR2, readPlanBundle } from "@/server/jobs/plan-bundle";
import { readCatalog } from "@/server/catalog/storage";
import { parseCatalog, buildVideoMap } from "@/server/catalog/parser";
import { sortTimelineForRender } from "@/server/pipeline/validator";
import { buildFcp7Xml } from "@/server/export/fcp7-xml";
import { srtFileBuffer } from "@/server/export/srt";
import { prepareExportMedia } from "@/server/export/media-bundle";
import type { ResolvedPick, Scene, WhisperSegment } from "@/shared/types";

// archiver is CommonJS; routing it through the bundler mangles the call
// (`import archiver from "archiver"` → runtime `s.default(...)` is not a
// function). Load it natively. Its dependency closure is copied into the
// standalone tree by scripts/prepare-standalone.cjs.
const archiver = createRequire(import.meta.url)("archiver") as typeof import("archiver");

function buildReadme(jobId: string): string {
  return [
    `WeatherV1 → Premiere export for job ${jobId}`,
    "",
    "This bundle is self-contained — every clip, the voiceover, and the background",
    "music are included under ./media. Nothing is referenced from elsewhere.",
    "",
    "Contents:",
    `  forecast_${jobId}.xml   FCP7 (XMEML) sequence — the AI-planned edit.`,
    `  forecast_${jobId}.srt   Hebrew captions (UTF-8 with BOM).`,
    "  media/                 Trimmed clips (+1s handles) + voiceover + bg music.",
    "",
    "Open in Premiere:",
    "  1. Extract this whole zip to a folder (keep the .xml next to ./media).",
    `  2. File > Import… and choose forecast_${jobId}.xml FROM THE EXTRACTED FOLDER.`,
    "     A 1080×1920, 30 fps sequence appears exactly as planned — clips at their",
    "     cut points, voiceover, and background music (mixed at -16 dB). Each clip is",
    "     trimmed to its cut with ~1 second of handle on each side, so you can nudge",
    "     either edge by up to a second (a touch less for cuts at a clip's start/end).",
    "  3. If Premiere lists media as offline, choose Locate, point at the ./media",
    "     folder, and enable 'Relink others automatically' — everything is in there.",
    "  4. Scene boundaries are sequence markers; each clip's pick reason is in the",
    "     clip Notes column.",
    "",
    "Captions (Hebrew / RTL):",
    "  The .srt is a sidecar — drag it onto a caption track. For correct right-to-left",
    "  rendering, right-click the caption track header > Track Settings > Text Engine",
    "  and choose 'South Asian and Middle Eastern'.",
    "",
  ].join("\n");
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const denied = assertDesktopAuth(req);
  if (denied) return denied;

  const { jobId } = await params;

  try {
    await hydratePlanBundleFromR2(jobId).catch(() => {});
    const bundle = readPlanBundle(jobId) as Record<string, unknown>;
    if (!bundle.job_id) {
      return NextResponse.json({ success: false, error: "Plan not found" }, { status: 404 });
    }

    const timeline = [...((bundle.timeline as ResolvedPick[] | undefined) ?? [])];
    if (!timeline.length) {
      return NextResponse.json({ success: false, error: "No timeline to export" }, { status: 404 });
    }
    sortTimelineForRender(timeline);

    const scenes = (bundle.scenes as Scene[] | undefined) ?? [];
    const segments = (bundle.transcript_segments as WhisperSegment[] | undefined) ?? [];
    const durationSec = Number(bundle.duration_sec ?? 0);
    const audioFilename = String(bundle.audio_filename ?? "");
    const videoMap = buildVideoMap(parseCatalog(readCatalog()));

    const prepared = await prepareExportMedia({ jobId, timeline, durationSec, videoMap, audioFilename });

    const xml = buildFcp7Xml({
      jobId,
      durationSec,
      clips: prepared.clips,
      scenes,
      voiceover: prepared.voiceover,
      bgMusic: prepared.bgMusic,
    });

    // STORE (no compression) — bundled media is already compressed; stream
    // entries straight from disk so memory stays flat regardless of media size.
    const archive = archiver("zip", { store: true });
    let cleaned = false;
    const cleanupOnce = () => {
      if (cleaned) return;
      cleaned = true;
      void prepared.cleanup();
    };
    archive.on("end", cleanupOnce);
    archive.on("close", cleanupOnce);
    archive.on("error", cleanupOnce);

    archive.append(xml, { name: `forecast_${jobId}.xml` });
    archive.append(srtFileBuffer(segments), { name: `forecast_${jobId}.srt` });
    archive.append(buildReadme(jobId), { name: "README.txt" });
    for (const file of prepared.files) {
      archive.append(fs.createReadStream(file.localPath), { name: file.zipName });
    }
    void archive.finalize();

    const webStream = Readable.toWeb(archive as unknown as Readable) as ReadableStream<Uint8Array>;
    return new Response(webStream, {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="forecast_${jobId}_premiere.zip"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[export/premiere] ${jobId} failed:`, err);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
