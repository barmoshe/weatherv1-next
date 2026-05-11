import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { v4 as uuidv4 } from "uuid";
import { readCatalog, writeCatalog, VIDEOS_DIR, invalidateCatalogCache } from "@/server/catalog/storage";
import { parseCatalog } from "@/server/catalog/parser";
import { probeVideo } from "@/server/ffmpeg/probe";
import { generatePoster } from "@/server/ffmpeg/posters";
import { isValidSource, SOURCE_VALUES } from "@/server/tag-vocab";
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
  const formData = await req.formData();
  const file = formData.get("file");
  if (!file || typeof file === "string") {
    return NextResponse.json({ success: false, error: "No file provided" }, { status: 400 });
  }

  const fileName = (file as File).name;
  const ext = path.extname(fileName).toLowerCase();
  if (![".mp4", ".mov"].includes(ext)) {
    return NextResponse.json(
      { success: false, error: `Unsupported extension ${ext}` },
      { status: 400 }
    );
  }

  const tmpName = `_pending_${uuidv4().replace(/-/g, "")}${ext}`;
  const tmpPath = path.join(VIDEOS_DIR, tmpName);

  const bytes = await (file as File).arrayBuffer();
  fs.writeFileSync(tmpPath, Buffer.from(bytes));

  const probe = await probeVideo(tmpPath);
  const durationSec = probe.durationSec;
  const orientation = probe.orientation;

  const metaRaw = formData.get("metadata");
  let metadata: Record<string, unknown> = {};
  try {
    if (typeof metaRaw === "string") metadata = JSON.parse(metaRaw);
  } catch {
    // ignore
  }

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
    let finalPath = path.join(VIDEOS_DIR, finalName);
    let resolvedName = finalName;
    let i = 2;
    while (fs.existsSync(finalPath)) {
      resolvedName = `${path.basename(finalName, ext)}-${i}${ext}`;
      finalPath = path.join(VIDEOS_DIR, resolvedName);
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
      const POSTERS_DIR = path.join(process.cwd(), "runtime", "cache", "posters");
      await generatePoster(finalPath, newId, POSTERS_DIR);
    } catch (e) {
      console.warn(`Poster generation failed for ${newId}:`, e);
    }

    return NextResponse.json({ success: true, video: entry });
  } catch (err) {
    try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
