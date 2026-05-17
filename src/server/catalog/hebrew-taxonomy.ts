import type { SegmentConcepts, SegmentEntry } from "@/shared/types";

export const HEBREW_TAG_VOCAB = [
  "גשם",
  "שמש",
  "שלג",
  "סופה",
  "ערפל",
  "עננים",
  "רוח",
  "שמיים בהירים",
  "מעונן חלקית",
  "מעונן",
  "ברד",
  "עירוני",
  "טבע",
  "ים",
  "הרים",
  "פנים",
  "צילום רחפן",
  "אנשים",
  "ילדים",
  "המון",
  "לבוש",
  "יום",
  "לילה",
  "שעת זהב",
  "זריחה",
  "בין ערביים",
  "צהריים",
  "חם",
  "חמים",
  "מתון",
  "קריר",
  "קר",
  "קיץ",
  "חורף",
  "מעבר",
  "צפון",
  "מרכז",
  "דרום",
  "חוף",
  "פנים הארץ",
  "נגב",
  "ערבה",
  "גולן",
  "גליל",
  "חרמון",
  "כנרת",
  "ים המלח",
  "אילת",
  "רגוע",
  "דרמטי",
  "קודר",
  "שמח",
] as const;

export const HEBREW_TAG_SCHEMA = {
  version: "hebrew-abstract-v1",
  language: "he",
  updated_at: "2026-05-13",
  tags: HEBREW_TAG_VOCAB,
  concept_vocab: {
    weather: ["שרב", "חם", "בהיר", "מעונן", "גשם", "רוח", "ברד", "שלג"],
    season_mood: ["קיצי", "חורפי", "סתווי", "אביבי", "מעבר"],
    visual_role: [
      "רקע כללי",
      "אזהרת מזג אוויר",
      "עומס חום",
      "הקלה בחום",
      "תחזית ים",
      "לבוש",
      "עיר",
      "טבע",
    ],
    scene_fit: [
      "פתיחה חמה",
      "שרב",
      "טמפרטורות",
      "סוף שבוע נעים",
      "קרינת שמש",
      "ים ושקיעה",
    ],
  },
  legacy_aliases: {
    rain: "גשם",
    sun: "שמש",
    snow: "שלג",
    storm: "סופה",
    fog: "ערפל",
    clouds: "עננים",
    wind: "רוח",
    hail: "ברד",
    clear_sky: "שמיים בהירים",
    partly_cloudy: "מעונן חלקית",
    overcast: "מעונן",
    urban: "עירוני",
    nature: "טבע",
    sea: "ים",
    mountain: "הרים",
    indoor: "פנים",
    aerial: "צילום רחפן",
    people: "אנשים",
    kids: "ילדים",
    crowd: "המון",
    clothing: "לבוש",
    day: "יום",
    night: "לילה",
    golden_hour: "שעת זהב",
    dawn: "זריחה",
    dusk: "בין ערביים",
    midday: "צהריים",
    hot: "חם",
    warm: "חמים",
    mild: "מתון",
    cool: "קריר",
    cold: "קר",
    summer: "קיץ",
    winter: "חורף",
    inbetween: "מעבר",
    north: "צפון",
    center: "מרכז",
    south: "דרום",
    coast: "חוף",
    inland: "פנים הארץ",
    negev: "נגב",
    arava: "ערבה",
    golan: "גולן",
    galilee: "גליל",
    hermon: "חרמון",
    kinneret: "כנרת",
    "dead-sea": "ים המלח",
    eilat: "אילת",
    calm: "רגוע",
    dramatic: "דרמטי",
    gloomy: "קודר",
    cheerful: "שמח",
    "יום": "יום",
    "רוח": "רוח",
    "שלכת": "סתווי",
    "ביגוד": "לבוש",
  } satisfies Record<string, string>,
} as const;

const TAG_SET = new Set<string>(HEBREW_TAG_VOCAB);
const ALIAS = HEBREW_TAG_SCHEMA.legacy_aliases as Record<string, string>;

const WEATHER_TAGS = new Set(["גשם", "שמש", "שלג", "סופה", "ערפל", "עננים", "רוח", "שמיים בהירים", "מעונן חלקית", "מעונן", "ברד"]);
const LIGHT_TAGS = new Set(["יום", "לילה", "שעת זהב", "זריחה", "בין ערביים", "צהריים"]);
const SUBJECT_TAGS = new Set(["עירוני", "טבע", "ים", "הרים", "פנים", "צילום רחפן"]);

function addUnique(out: string[], value: string | undefined): void {
  const v = value?.trim();
  if (v && !out.includes(v)) out.push(v);
}

function norm(text: string): string {
  return text.toLowerCase().replace(/[֑-ׇ]/g, "");
}

function includesAny(text: string, needles: string[]): boolean {
  const n = norm(text);
  return needles.some((needle) => n.includes(norm(needle)));
}

export function canonicalHebrewTag(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (TAG_SET.has(trimmed)) return trimmed;
  return ALIAS[trimmed] ?? null;
}

export function isHebrewVocabValue(value: string): boolean {
  return TAG_SET.has(value.trim());
}

export function normalizeHebrewTags(tags: string[]): string[] {
  const out: string[] = [];
  for (const tag of tags) {
    const canonical = canonicalHebrewTag(String(tag));
    if (canonical && TAG_SET.has(canonical)) addUnique(out, canonical);
  }
  return out;
}

export function flattenConcepts(concepts: SegmentConcepts | undefined): string[] {
  if (!concepts) return [];
  return [
    ...(concepts.weather ?? []),
    ...(concepts.season_mood ?? []),
    ...(concepts.visual_role ?? []),
    ...(concepts.scene_fit ?? []),
    ...(concepts.avoid_for ?? []),
  ].filter(Boolean);
}

function tagArray(tags: string[] | Record<string, string> | undefined): string[] {
  if (!tags) return [];
  if (Array.isArray(tags)) return tags;
  return Object.values(tags);
}

export function segmentSearchTerms(segment: { tags?: string[] | Record<string, string>; concepts?: SegmentConcepts; description?: string }): string[] {
  const terms = [
    ...tagArray(segment.tags),
    ...flattenConcepts(segment.concepts),
    segment.description ?? "",
  ];
  return [...new Set(terms.map((x) => String(x).trim()).filter(Boolean))];
}

export function inferConcepts(input: {
  description: string;
  tags: string[];
  filename?: string;
}): SegmentConcepts {
  const description = input.description ?? "";
  const filename = input.filename ?? "";
  const tags = normalizeHebrewTags(input.tags);
  const text = `${description} ${filename} ${tags.join(" ")}`;

  const weather: string[] = [];
  const season: string[] = [];
  const role: string[] = [];
  const sceneFit: string[] = [];
  const avoidFor: string[] = [];

  if (tags.includes("ברד") || includesAny(text, ["ברד"])) addUnique(weather, "ברד");
  if (tags.includes("שלג") || includesAny(text, ["שלג", "מושלג", "חרמון"])) addUnique(weather, "שלג");
  if (tags.includes("גשם") || includesAny(text, ["גשם", "טפטוף", "רטוב", "שלוליות", "שיטפון"])) addUnique(weather, "גשם");
  if (tags.includes("רוח") || includesAny(text, ["רוח", "רוחות", "מתנופף"])) addUnique(weather, "רוח");
  if (tags.includes("מעונן") || tags.includes("מעונן חלקית") || tags.includes("עננים") || tags.includes("ערפל") || includesAny(text, ["מעונן", "עננים", "אפור", "ערפל", "קודר"])) {
    addUnique(weather, "מעונן");
  }
  if (tags.includes("שמיים בהירים") || tags.includes("שמש") || includesAny(text, ["שמש", "בהיר", "כחולים", "שטוף שמש"])) {
    addUnique(weather, "בהיר");
  }
  if (
    tags.includes("חם")
    || includesAny(text, ["חם", "חום", "חמים", "קיץ", "קיצי", "מדבר", "צחיח", "יבש", "שרב", "חמסין"])
    || /\bטמפרטורות\s*(גבוהות|חמות)\b/.test(text)
    || /(\d{2,3})\s*מעלות/.test(text)
  ) {
    addUnique(
      weather,
      includesAny(text, ["שרב", "עומס חום", "חמסין", "גל החום", "גל חום"]) ? "שרב" : "חם",
    );
  }

  if (tags.includes("קיץ") || tags.includes("חם") || includesAny(text, ["קיץ", "קיצי", "חם", "מדבר", "צחיח"])) addUnique(season, "קיצי");
  if (tags.includes("חורף") || tags.includes("קר") || tags.includes("שלג") || tags.includes("ברד") || includesAny(text, ["חורף", "חורפי", "קר", "שלג", "ברד"])) addUnique(season, "חורפי");
  if (includesAny(text, ["שלכת", "סתיו", "סתווית"])) addUnique(season, "סתווי");
  if (includesAny(text, ["שקד", "פריחה", "אביב", "אביבי"])) addUnique(season, "אביבי");
  if (!season.length || tags.includes("מעבר")) addUnique(season, "מעבר");

  if (tags.includes("ים")) addUnique(role, "תחזית ים");
  if (tags.includes("לבוש") || includesAny(text, ["מעיל", "חולצה", "כפפות", "צעיף", "לבוש"])) addUnique(role, "לבוש");
  if (tags.includes("עירוני")) addUnique(role, "עיר");
  if (tags.includes("טבע") || tags.includes("הרים")) addUnique(role, "טבע");
  if (weather.includes("חם") || weather.includes("שרב")) addUnique(role, "עומס חום");
  if (["גשם", "רוח", "ברד", "שלג"].some((w) => weather.includes(w))) addUnique(role, "אזהרת מזג אוויר");
  addUnique(role, "רקע כללי");

  if (weather.includes("חם") || weather.includes("שרב")) {
    addUnique(sceneFit, "פתיחה חמה");
    addUnique(sceneFit, "שרב");
    addUnique(sceneFit, "טמפרטורות");
    addUnique(sceneFit, "קרינת שמש");
  }
  if (weather.includes("בהיר") || season.includes("מעבר") || tags.includes("רגוע")) addUnique(sceneFit, "סוף שבוע נעים");
  if (tags.includes("ים") || includesAny(text, ["ים", "גלים", "חוף", "שקיעה"])) addUnique(sceneFit, "ים ושקיעה");
  if (!sceneFit.length) addUnique(sceneFit, "טמפרטורות");

  if (season.includes("חורפי") || season.includes("סתווי") || weather.some((w) => ["גשם", "שלג", "ברד", "מעונן"].includes(w))) {
    addUnique(avoidFor, "שרב");
  }
  if (weather.includes("חם") || weather.includes("שרב") || season.includes("קיצי")) {
    addUnique(avoidFor, "חורף");
  }

  return {
    weather: weather.length ? weather : ["בהיר"],
    season_mood: season,
    visual_role: role,
    scene_fit: sceneFit,
    avoid_for: avoidFor,
  };
}

export function auditHebrewSegment(segment: SegmentEntry): string[] {
  const issues: string[] = [];
  const tags = segment.tags ?? [];
  if (!tags.length) issues.push("missing tags");
  for (const tag of tags) {
    if (!isHebrewVocabValue(tag)) issues.push(`unknown tag: ${tag}`);
    if (/[A-Za-z_]/.test(tag)) issues.push(`non-hebrew tag: ${tag}`);
  }
  const concepts = segment.concepts;
  if (!concepts) {
    issues.push("missing concepts");
  } else {
    if (!concepts.weather?.length) issues.push("missing weather concept");
    if (!concepts.season_mood?.length) issues.push("missing season_mood concept");
    if (!concepts.visual_role?.length) issues.push("missing visual_role concept");
    if (!concepts.scene_fit?.length) issues.push("missing scene_fit concept");
  }
  if (!tags.some((t) => WEATHER_TAGS.has(t))) issues.push("missing weather tag");
  if (!tags.some((t) => LIGHT_TAGS.has(t))) issues.push("missing light tag");
  if (!tags.some((t) => SUBJECT_TAGS.has(t))) issues.push("missing subject tag");
  return issues;
}

export function targetContradictsSegment(targetText: string, segment: { tags?: string[] | Record<string, string>; concepts?: SegmentConcepts; description?: string }): boolean {
  const target = norm(targetText);
  const terms = segmentSearchTerms(segment).map(norm);
  const has = (value: string) => terms.some((term) => term.includes(norm(value)));

  const targetHot = includesAny(target, ["שרב", "חם", "חום", "חמסין", "עומס חום", "קרינת שמש", "heat", "hot"]);
  const targetRain = includesAny(target, ["גשם", "טפטוף", "ממטר", "rain", "drizzle"]);
  const targetNice = includesAny(target, ["נעים", "נוחות", "הקלה", "comfortable", "mild"]);

  if (targetHot && (has("חורפי") || has("סתווי") || has("שלכת") || has("גשם") || has("ברד") || has("שלג") || has("מעונן"))) return true;
  if (targetRain && (has("שרב") || has("חם") || has("שמיים בהירים"))) return true;
  if (targetNice && (has("שרב") || has("סופה") || has("ברד") || has("שלג"))) return true;
  return false;
}
