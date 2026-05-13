import { HEBREW_TAG_VOCAB, canonicalHebrewTag } from "@/server/catalog/hebrew-taxonomy";

export const TAG_VOCAB: string[] = [...HEBREW_TAG_VOCAB];

export const SOURCE_VALUES = [
  "getty",
  "artlist",
  "whatsapp",
  "original",
  "other",
] as const;
export type SourceValue = (typeof SOURCE_VALUES)[number];

const TAG_SET = new Set(TAG_VOCAB);
const SOURCE_SET = new Set<string>(SOURCE_VALUES);
const VIBE_SET = new Set(["calm", "dramatic", "gloomy"]);

export function isVocabValue(value: string): boolean {
  return TAG_SET.has(value) || canonicalHebrewTag(value) != null;
}

export function isValidSource(value: string | null | undefined): boolean {
  return value == null || SOURCE_SET.has(value);
}

export function isVibe(value: string): boolean {
  return VIBE_SET.has(value);
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a) return b.length;
  if (!b) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  let cur = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[b.length];
}

export function suggestClosest(unknown: string, n = 3): string[] {
  if (!unknown) return [];
  const target = unknown.toLowerCase().trim();
  const scored = TAG_VOCAB.map((v) => ({ d: levenshtein(target, v), v }));
  scored.sort((a, b) => a.d - b.d || a.v.localeCompare(b.v));
  return scored.slice(0, n).map((x) => x.v);
}
