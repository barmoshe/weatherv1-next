export const PLACE_ALIASES: Record<string, string[]> = {
  north: ["צפון", "north"],
  center: ["מרכז", "center"],
  south: ["דרום", "south"],
  coast: ["חוף", "ים-תיכון", "ים התיכון", "coast"],
  inland: ["פנים-הארץ", "פנים הארץ", "פנים", "inland"],
  negev: ["נגב", "negev"],
  arava: ["ערבה", "arava"],
  golan: ["גולן", "רמת-הגולן", "רמת הגולן", "golan"],
  galilee: ["גליל", "galilee"],
  hermon: ["חרמון", "hermon"],
  kinneret: ["כנרת", "כינרת", "kinneret"],
  "dead-sea": ["ים-המלח", "ים המלח", "dead-sea", "dead sea"],
  eilat: ["אילת", "eilat"],
  gaza: ["עזה", "gaza"],
  "northern-border": ["גבול הצפון", "גבול-הצפון", "northern border"],
  "southern-border": ["גבול הדרום", "גבול-הדרום", "southern border"],
};

export const REGION_MARKERS = new Set([
  "north", "south", "center", "coast", "inland",
  "negev", "arava", "golan", "galilee", "hermon",
  "gaza", "northern-border", "southern-border",
]);

export interface RegionHit {
  slug: string;
  alias: string;
  charStart: number;
  charEnd: number;
}

export function detectRegions(text: string): RegionHit[] {
  if (!text) return [];
  const lower = text.toLowerCase();

  const pairs: Array<[string, string]> = [];
  for (const slug of REGION_MARKERS) {
    for (const alias of PLACE_ALIASES[slug] ?? []) {
      pairs.push([alias.toLowerCase(), slug]);
    }
  }
  // Longer aliases win over shorter at same offset
  pairs.sort((a, b) => b[0].length - a[0].length);

  const claimed = new Array<boolean>(lower.length).fill(false);
  const hits: RegionHit[] = [];

  for (const [alias, slug] of pairs) {
    if (!alias) continue;
    let start = 0;
    while (true) {
      const i = lower.indexOf(alias, start);
      if (i < 0) break;
      const end = i + alias.length;
      if (!claimed.slice(i, end).some(Boolean)) {
        hits.push({ slug, alias, charStart: i, charEnd: end });
        for (let k = i; k < end; k++) claimed[k] = true;
      }
      start = end;
    }
  }

  hits.sort((a, b) => a.charStart - b.charStart);
  return hits;
}
