// Strip Hebrew niqqud (vowel diacritics) for matching
function stripNiqqud(s: string): string {
  return s.replace(/[֑-ׇ]/g, "");
}

function norm(text: string): string {
  return stripNiqqud(text).toLowerCase();
}

const CLOTHING_KEYWORDS = new Set([
  // Hebrew
  "מעיל", "ביגוד", "לבוש", "בגד", "בגדים", "שכבת",
  "סוודר", "בגד עליון", "שרבול", "חולצה", "חולצות", "מכנסיים",
  "כובע", "כפפות", "צעיף", "סנדלים", "נעליים",
  "משקפי שמש", "משקפיים", "מטריה", "מטריות",
  // English
  "coat", "jacket", "clothing", "clothes",
  "wear", "wardrobe", "sweater", "scarf", "gloves",
  "hat", "boots", "sunglasses", "shades", "umbrella",
]);

const HOT_NARRATION_KEYWORDS = new Set([
  "יום חם", "ימים חמים", "חם מאוד", "חום כבד",
  "התחממ", "מתחמם", "מתחממת", "מתחממים",
  "חמסין", "שרב", "גל חום", "עומס חום", "מעיק",
  "קיץ", "קיצי", "קיצית", "קיציים",
  "בגד קל", "בגדים קלים", "אוורירי", "אווירי",
  "שרבול קצר", "שרוול קצר",
  "טמפרטורות גבוהות", "טמפרטורה גבוהה", "טמפ' גבוהות", "טמפ' גבוהה",
  "גבוהות מהרגיל", "גבוה מהרגיל", "מעל לרגיל", "מעל לממוצע",
  "hot day", "heat wave", "heatwave", "hot weather", "summer",
  "warming", "warms up", "light clothing", "light layers",
  "short sleeves", "short-sleeved", "above normal", "above average", "higher than usual",
]);

const COLD_NARRATION_KEYWORDS = new Set([
  "יום קר", "קור כבד", "התקרר", "מתקרר", "מתקררת",
  "חורף", "חורפי", "חורפית", "חורפיים",
  "סופה", "סופות", "סער", "שלג", "מושלג", "ברד",
  "ירידה חדה בטמפר", "ירידה בטמפר", "צונן", "צוננת",
  "טמפרטורות נמוכות", "טמפרטורה נמוכה", "טמפ' נמוכות", "טמפ' נמוכה",
  "נמוכות מהרגיל", "נמוך מהרגיל", "מתחת לרגיל", "מתחת לממוצע",
  "קרירות", "קרירה", "קרירים",
  "cold day", "cold weather", "wintry", "wintery", "winter",
  "snow", "snowy", "storm", "frost", "frosty", "freezing", "chilly",
  "below normal", "below average", "lower than usual",
]);

const OVERCAST_NARRATION_KEYWORDS = new Set([
  "מעונן", "מעוננת", "מעוננים", "מעוננות",
  "טפטוף", "טפטופים", "מטפטף",
  "גשם", "גשמים", "ממטר", "אפור",
  "קודר", "קודרת", "קודרים",
  "סער", "סופה", "סופות", "סוער",
  "חורף", "חורפי", "חורפית", "חורפיים",
  "עננים כבדים", "מעונן חלקית", "ערפל", "ערפילי",
  "overcast", "drizzle", "drizzly", "rain", "rainy", "stormy",
  "cloudy", "grey", "gray", "gloomy",
]);

const COLD_GARMENT_KEYWORDS = new Set([
  "מעיל", "פרווה", "סוודר", "צעיף", "צעיפים",
  "כפפות", "צמר", "מגפ", "חורפ",
  "coat", "jacket", "parka", "puffer",
  "scarf", "scarves", "gloves", "mittens",
  "sweater", "wool", "boots", "winter",
]);

const HOT_GARMENT_KEYWORDS = new Set([
  "שרבול קצר", "שרוול קצר", "חולצה קצרה", "גופייה", "גופיות",
  "סנדל", "כפכפ", "בגד ים", "בגדי ים", "ביקיני", "בגד קל", "אוורירי",
  "tank top", "tanktop", "sandals", "flip-flops", "shorts",
  "swimsuit", "swimwear", "bikini", "sleeveless", "sundress",
]);

function matchesAny(text: string, keywords: Set<string>): boolean {
  if (!text) return false;
  const n = norm(text);
  for (const kw of keywords) {
    if (n.includes(kw)) return true;
  }
  return false;
}

export function isClothingText(text: string): boolean {
  return matchesAny(text, CLOTHING_KEYWORDS);
}

export function isClothingTag(tagValue: string): boolean {
  return isClothingText(tagValue ?? "");
}

export function isHotWeatherNarration(text: string): boolean {
  return matchesAny(text, HOT_NARRATION_KEYWORDS);
}

export function isColdWeatherNarration(text: string): boolean {
  return matchesAny(text, COLD_NARRATION_KEYWORDS);
}

export function isOvercastNarration(text: string): boolean {
  return matchesAny(text, OVERCAST_NARRATION_KEYWORDS);
}

export function depictsColdGarments(text: string): boolean {
  return matchesAny(text, COLD_GARMENT_KEYWORDS);
}

export function depictsHotGarments(text: string): boolean {
  return matchesAny(text, HOT_GARMENT_KEYWORDS);
}

export function clothingClimateMismatch(sceneText: string, segmentText: string): boolean {
  const sceneHot = isHotWeatherNarration(sceneText);
  const sceneCold = isColdWeatherNarration(sceneText);
  const segCold = depictsColdGarments(segmentText);
  const segHot = depictsHotGarments(segmentText);
  if (sceneHot && segCold) return true;
  if (sceneCold && segHot) return true;
  return false;
}
