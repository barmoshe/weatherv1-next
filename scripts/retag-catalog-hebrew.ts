#!/usr/bin/env tsx
/**
 * Retag the full catalog into the Hebrew abstract taxonomy.
 *
 * Defaults to dry-run:
 *   npx tsx scripts/retag-catalog-hebrew.ts
 *
 * Write + safe R2 push:
 *   npx tsx scripts/retag-catalog-hebrew.ts --write --push-r2
 */

import fs from "node:fs";
import path from "node:path";
import { CatalogSchema, type Catalog, type CatalogEntry, type SegmentEntry } from "@/shared/types";
import { readCatalog, writeCatalog, getCatalogPath } from "@/server/catalog/storage";
import { getRuntimePaths } from "@/server/runtime/paths";
import { pushCatalogToR2, R2CatalogConflictError } from "@/server/sync/r2/service";
import { r2Configured } from "@/server/sync/r2/client";
import {
  HEBREW_TAG_SCHEMA,
  auditHebrewSegment,
  inferConcepts,
  normalizeHebrewTags,
} from "@/server/catalog/hebrew-taxonomy";

interface ProposalRow {
  clipId: string;
  segId: string;
  oldTags: string[];
  newTags: string[];
  oldDescription: string;
  concepts: SegmentEntry["concepts"];
  oldConfidence?: number;
  taxonomyConfidence: number;
  rationale: string;
  reviewRequired: boolean;
  issues: string[];
}

function hasArg(name: string): boolean {
  return process.argv.includes(name);
}

function ensureDir(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function unique(items: string[]): string[] {
  const out: string[] = [];
  for (const item of items) {
    const v = item.trim();
    if (v && !out.includes(v)) out.push(v);
  }
  return out;
}

const WEATHER_TAGS = new Set(["גשם", "שמש", "שלג", "סופה", "ערפל", "עננים", "רוח", "שמיים בהירים", "מעונן חלקית", "מעונן", "ברד"]);
const LIGHT_TAGS = new Set(["יום", "לילה", "שעת זהב", "זריחה", "בין ערביים", "צהריים"]);
const SUBJECT_TAGS = new Set(["עירוני", "טבע", "ים", "הרים", "פנים", "צילום רחפן"]);

function textOf(entry: CatalogEntry, seg: SegmentEntry): string {
  return `${seg.description ?? ""} ${entry.filename ?? ""} ${(seg.tags ?? []).join(" ")}`.toLowerCase();
}

function addRequiredAxes(entry: CatalogEntry, seg: SegmentEntry, tags: string[]): string[] {
  const out = [...tags];
  const text = textOf(entry, seg);
  const add = (tag: string) => {
    if (!out.includes(tag)) out.push(tag);
  };

  if (!out.some((t) => WEATHER_TAGS.has(t))) {
    if (/ברד/.test(text)) add("ברד");
    else if (/שלג|חרמון/.test(text)) add("שלג");
    else if (/גשם|טפטוף|שיטפון|רטוב|שלול/.test(text)) add("גשם");
    else if (/רוח|רוחות/.test(text)) add("רוח");
    else if (/ערפל|אפור|מעונן|קודר/.test(text)) add("מעונן");
    else if (/עננ/.test(text)) add("מעונן חלקית");
    else add("שמיים בהירים");
  }

  if (!out.some((t) => LIGHT_TAGS.has(t))) {
    if (/לילה|ירח|שחור/.test(text)) add("לילה");
    else if (/זריחה/.test(text)) add("זריחה");
    else if (/שעת זהב|זהוב|שקיעה|כתומ|ורוד/.test(text)) add("שעת זהב");
    else if (/צהריים|צהר/.test(text)) add("צהריים");
    else if (/ערב|דמדומים|בין ערביים/.test(text)) add("בין ערביים");
    else add("יום");
  }

  if (!out.some((t) => SUBJECT_TAGS.has(t))) {
    if (/ים|חוף|גלים|כינרת|כנרת/.test(text)) add("ים");
    else if (/רחוב|כביש|בניין|עיר|שכונה|מגדל|תל אביב|ירושלים/.test(text)) add("עירוני");
    else if (/בית|חדר|מטבח|מפה|ראדאר|אולם/.test(text)) add("פנים");
    else if (/הר|הרים|חרמון|גבע/.test(text)) add("הרים");
    else add("טבע");
  }

  return unique(out);
}

function conceptsToTags(concepts: SegmentEntry["concepts"]): string[] {
  const out: string[] = [];
  if (!concepts) return out;
  if (concepts.weather?.includes("גשם")) out.push("גשם");
  if (concepts.weather?.includes("רוח")) out.push("רוח");
  if (concepts.weather?.includes("ברד")) out.push("ברד");
  if (concepts.weather?.includes("שלג")) out.push("שלג");
  if (concepts.weather?.includes("מעונן")) out.push("מעונן");
  if (concepts.weather?.includes("בהיר")) out.push("שמיים בהירים");
  if (concepts.weather?.some((w) => w === "חם" || w === "שרב")) out.push("חם", "שמש");
  if (concepts.season_mood?.includes("קיצי")) out.push("קיץ");
  if (concepts.season_mood?.includes("חורפי")) out.push("חורף");
  if (concepts.visual_role?.includes("תחזית ים")) out.push("ים");
  if (concepts.visual_role?.includes("לבוש")) out.push("לבוש");
  if (concepts.visual_role?.includes("עיר")) out.push("עירוני");
  if (concepts.visual_role?.includes("טבע")) out.push("טבע");
  return out;
}

function buildProposal(catalog: Catalog): { catalog: Catalog; rows: ProposalRow[]; issues: string[] } {
  const rows: ProposalRow[] = [];
  const issues: string[] = [];
  const next: Catalog = {
    ...catalog,
    tag_schema: HEBREW_TAG_SCHEMA,
    videos: catalog.videos.map((entry) => {
      const segments = (entry.segments ?? []).map((seg) => {
        const oldTags = seg.tags ?? [];
        const normalized = normalizeHebrewTags(oldTags);
        const concepts = inferConcepts({
          description: seg.description ?? "",
          tags: normalized,
          filename: entry.filename,
        });
        const newTags = addRequiredAxes(entry, seg, unique([...normalized, ...conceptsToTags(concepts)]));
        const taxonomyConfidence =
          typeof seg.confidence === "number" && seg.confidence > 0
            ? Math.max(seg.confidence, 0.75)
            : oldTags.some((t) => /[A-Za-z_]/.test(t))
              ? 0.7
              : 0.8;
        const nextSeg: SegmentEntry = {
          ...seg,
          tags: newTags,
          concepts,
          confidence: Math.round(taxonomyConfidence * 100) / 100,
        };
        const segIssues = auditHebrewSegment(nextSeg);
        issues.push(...segIssues.map((issue) => `${seg.id ?? "(missing id)"}: ${issue}`));
        rows.push({
          clipId: entry.id,
          segId: seg.id ?? `${entry.id}-s${rows.length}`,
          oldTags,
          newTags,
          oldDescription: seg.description ?? "",
          concepts,
          oldConfidence: seg.confidence,
          taxonomyConfidence: nextSeg.confidence ?? taxonomyConfidence,
          rationale: `Converted to Hebrew tags and inferred abstract concepts from description, legacy tags, and filename.`,
          reviewRequired:
            (seg.confidence ?? 0) < 0.5 ||
            oldTags.some((t) => /[A-Za-z_]/.test(t)) ||
            segIssues.length > 0,
          issues: segIssues,
        });
        return nextSeg;
      });
      return { ...entry, segments };
    }),
  };
  return { catalog: next, rows, issues };
}

function writeBackup(): string {
  const src = getCatalogPath();
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backup = `${src}.before-hebrew-retag-${stamp}`;
  fs.copyFileSync(src, backup);
  return backup;
}

async function main(): Promise<void> {
  const write = hasArg("--write");
  const pushR2 = hasArg("--push-r2");
  const catalog = readCatalog();
  const { catalog: nextCatalog, rows, issues } = buildProposal(catalog);
  CatalogSchema.parse(nextCatalog);

  const proposalPath = path.join(getRuntimePaths().cacheDir, "tagging", "catalog-retag-proposals.json");
  ensureDir(proposalPath);
  fs.writeFileSync(
    proposalPath,
    JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        write,
        summary: {
          videos: nextCatalog.videos.length,
          segments: rows.length,
          review_required: rows.filter((row) => row.reviewRequired).length,
          issues: issues.length,
        },
        rows,
      },
      null,
      2,
    ),
    "utf8",
  );

  console.log(`proposal: ${proposalPath}`);
  console.log(`videos=${nextCatalog.videos.length} segments=${rows.length} review_required=${rows.filter((row) => row.reviewRequired).length} issues=${issues.length}`);
  if (issues.length) {
    console.error(issues.slice(0, 20).join("\n"));
    throw new Error(`catalog Hebrew taxonomy audit failed with ${issues.length} issue(s)`);
  }

  if (!write) {
    console.log("dry-run only; pass --write to update the local catalog");
    return;
  }

  const backup = writeBackup();
  await writeCatalog(nextCatalog);
  console.log(`backup: ${backup}`);
  console.log("local catalog updated");

  if (!pushR2) {
    console.log("R2 push skipped; pass --push-r2 to publish with safe conflict checks");
    return;
  }

  if (!r2Configured()) {
    throw new Error("R2 is not configured in this process; set R2_SYNC_ENABLED, R2_GATEWAY_URL, R2_TENANT_ID, R2_APP_USERNAME, and R2_APP_PASSWORD before --push-r2");
  }

  try {
    const status = await pushCatalogToR2();
    console.log(`R2 catalog pushed safely; etag=${status.lastCatalogEtag ?? "unknown"}`);
  } catch (err) {
    if (err instanceof R2CatalogConflictError) {
      console.error("R2 conflict: remote catalog changed. Pull/reconcile before retrying.");
      process.exitCode = 2;
      return;
    }
    throw err;
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
