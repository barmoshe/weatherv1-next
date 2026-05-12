import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { v4 as uuidv4 } from "uuid";
import { readCatalog, writeCatalog, getVideosDir, invalidateCatalogCache } from "@/server/catalog/storage";
import { getRuntimePaths } from "@/server/runtime/paths";
import { assertDesktopAuth } from "@/server/runtime/auth";
import { parseCatalog } from "@/server/catalog/parser";
import { probeVideo } from "@/server/ffmpeg/probe";
import { generatePoster } from "@/server/ffmpeg/posters";
import { isValidSource, SOURCE_VALUES } from "@/server/tag-vocab";
import { syncPostersForVideo, uploadVideoForEntry } from "@/server/sync/r2/service";
import type { CatalogEntry } from "@/shared/types";

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
}

export async function POST(req: NextRequest) {
  const denied = assertDesktopAuth(req);
  if (denied) return denied;
  const videosDir = getVideosDir();
  fs.mkdirSync(videosDir, { recursive: true });
  const contentType = req.headers.get("content-type") ?? "";

  let fileName = "";
  let metadata: Record<string, unknown> = {};
  let tmpPath = "";

  if (contentType.includes("application/json")) {
    const data = (await req.json()) as {
      desktop_file_path?: string;
      metadata?: Record<string, unknown>;
    };
    const desktopFilePath = data.desktop_file_path?.trim();
    if (!desktopFilePath) {
      return NextResponse.json({ success: false, error: "No file provided" }, { status: 400 });
    }

    fileName = path.basename(desktopFilePath);
    metadata = data.metadata ?? {};

    const ext = path.extname(fileName).toLowerCase();
    if (![".mp4", ".mov"].includes(ext)) {
      return NextResponse.json(
        { success: false, error: `Unsupported extension ${ext}` },
        { status: 400 }
      );
    }

    const tmpName = `_pending_${uuidv4().replace(/-/g, "")}${ext}`;
    tmpPath = path.join(videosDir, tmpName);
    fs.copyFileSync(desktopFilePath, tmpPath);
  } else {
    const formData = await req.formData();
    const file = formData.get("file");
    if (!file || typeof file === "string") {
      return NextResponse.json({ success: false, error: "No file provided" }, { status: 400 });
    }

    fileName = (file as File).name;
    const ext = path.extname(fileName).toLowerCase();
    if (![".mp4", ".mov"].includes(ext)) {
      return NextResponse.json(
        { success: false, error: `Unsupported extension ${ext}` },
        { status: 400 }
      );
    }

    const tmpName = `_pending_${uuidv4().replace(/-/g, "")}${ext}`;
    tmpPath = path.join(videosDir, tmpName);

    const bytes = await (file as File).arrayBuffer();
    fs.writeFileSync(tmpPath, Buffer.from(bytes));

    const metaRaw = formData.get("metadata");
    try {
      if (typeof metaRaw === "string") metadata = JSON.parse(metaRaw);
    } catch {
      // ignore
    }
  }

  const ext = path.extname(fileName).toLowerCase();
  if (![".mp4", ".mov"].includes(ext)) {
    return NextResponse.json(
      { success: false, error: `Unsupported extension ${ext}` },
      { status: 400 }
    );
  }

  const probe = await probeVideo(tmpPath);
  const durationSec = probe.durationSec;
  const orientation = probe.orientation;

  const description = String(metadata.description ?? "");
  const incomingTags = (metadata.tags as Record<string, string>) ?? {};
  const incomingSource = metadata.source as string | undefined;
  const cleanedSrc = incomingSource?.trim() || null;

  if (!isValidSource(cleanedSrc)) {
    fs.unlinkSync(tmpPath);
    return NextResponse.json(
      { success: false, error: `unknown source value: ${cleanedSrc}`, field: "source", suggestions: SOURCE_VALUES },
      { status: 400 }
    );
  }

  try {
    const catalog = readCatalog();
    const existingIds = new Set(catalog.videos.map((v) => v.id));
    let n = 1;
    while (existingIds.has(`vid_${String(n).padStart(3, "0")}`)) n++;
    const newId = `vid_${String(n).padStart(3, "0")}`;

    const slug = slugify(description) || slugify(path.basename(fileName, ext));
    const finalName = slug ? `${newId}_${slug}${ext}` : `${newId}${ext}`;
    let finalPath = path.join(videosDir, finalName);
    let resolvedName = finalName;
    let i = 2;
    while (fs.existsSync(finalPath)) {
      resolvedName = `${path.basename(finalName, ext)}-${i}${ext}`;
      finalPath = path.join(videosDir, resolvedName);
      i++;
    }
    fs.renameSync(tmpPath, finalPath);

    const tags = { main: "", secondary: "", third: "" };
    for (const field of ["main", "secondary", "third"] as const) {
      const v = incomingTags[field];
      if (v != null && v !== "") tags[field] = String(v).trim();
    }

    const now = new Date().toISOString().slice(0, 19);
    const entry: CatalogEntry = {
      id: newId,
      filename: resolvedName,
      original_filename: fileName,
      description,
      duration_sec: durationSec,
      orientation,
      tags,
      source: (cleanedSrc ?? "original") as CatalogEntry["source"],
      added_at: now,
      segments: [],
    };

    catalog.videos.push(entry);
    await writeCatalog(catalog);
    invalidateCatalogCache();

    // Generate poster eagerly (non-fatal)
    try {
      await generatePoster(finalPath, newId, getRuntimePaths().postersDir);
    } catch (e) {
      console.warn(`Poster generation failed for ${newId}:`, e);
    }

    void uploadVideoForEntry(newId).catch((e) => {
      console.warn(`R2 upload failed for ${newId}:`, e);
    });
    void syncPostersForVideo(newId).catch((e) => {
      console.warn(`R2 poster sync failed for ${newId}:`, e);
    });

    return NextResponse.json({ success: true, video: entry });
  } catch (err) {
    try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
    invalidateCatalogCache();
    const msg = err instanceof Error ? err.message : String(err);
    const status = err instanceof Error && err.name === "CatalogConflictError" ? 409 : 500;
    return NextResponse.json({ success: false, error: msg }, { status });
  }
}
