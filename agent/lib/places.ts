// Map places for the `cities` scene: Hebrew names -> key + lon/lat. The projection matches
// agent/gfx/map.js (Natural Earth 10m outline, equirectangular scaled by cos 31.5°, 1000 px tall).
export const PLACES: Record<string, { he: string[]; lonlat: [number, number] }> = {
  jerusalem: { he: ["ירושלים"], lonlat: [35.214, 31.778] },
  telaviv: { he: ["תל אביב", "תל-אביב", "תל אביב-יפו"], lonlat: [34.78, 32.085] },
  haifa: { he: ["חיפה"], lonlat: [34.99, 32.794] },
  safed: { he: ["צפת"], lonlat: [35.496, 32.965] },
  beersheba: { he: ["באר שבע"], lonlat: [34.791, 31.252] },
  eilat: { he: ["אילת"], lonlat: [34.951, 29.557] },
  tiberias: { he: ["טבריה"], lonlat: [35.531, 32.794] },
  beitshean: { he: ["בית שאן"], lonlat: [35.497, 32.497] },
  eingedi: { he: ["עין גדי"], lonlat: [35.388, 31.461] },
  deadsea: { he: ["ים המלח"], lonlat: [35.39, 31.2] },
  hermon: { he: ["חרמון", "החרמון"], lonlat: [35.77, 33.3] },
  nazareth: { he: ["נצרת"], lonlat: [35.3, 32.7] },
  afula: { he: ["עפולה"], lonlat: [35.29, 32.61] },
  ashdod: { he: ["אשדוד"], lonlat: [34.65, 31.8] },
  ashkelon: { he: ["אשקלון"], lonlat: [34.57, 31.67] },
  sderot: { he: ["שדרות"], lonlat: [34.596, 31.525] },
  roshhaayin: { he: ["ראש העין"], lonlat: [34.956, 32.095] },
  netanya: { he: ["נתניה"], lonlat: [34.857, 32.33] },
  kiryatshmona: { he: ["קריית שמונה", "קרית שמונה"], lonlat: [35.57, 33.207] },
  katzrin: { he: ["קצרין", "רמת הגולן", "הגולן"], lonlat: [35.69, 32.99] },
  kinneret: { he: ["כנרת", "הכנרת"], lonlat: [35.59, 32.82] },
  mitzperamon: { he: ["מצפה רמון"], lonlat: [34.8, 30.61] },
  dimona: { he: ["דימונה"], lonlat: [35.03, 31.07] },
  arad: { he: ["ערד"], lonlat: [35.21, 31.26] },
};

const PROJ = { minx: 34.200272086414415, maxy: 33.40671747037255, sc: 255.3118023594275, k: 0.8526401643540923 };

export function project([lon, lat]: [number, number]): [number, number] {
  return [(lon - PROJ.minx) * PROJ.k * PROJ.sc, (PROJ.maxy - lat) * PROJ.sc];
}

export function placeKey(name: string): string | null {
  const n = name.trim();
  for (const [key, p] of Object.entries(PLACES)) if (p.he.includes(n) || key === n) return key;
  return null;
}
