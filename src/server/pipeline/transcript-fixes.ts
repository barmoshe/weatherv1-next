export const WHISPER_HE_PROMPT =
  "תחזית מזג האוויר להיום. מזג האוויר בישראל: " +
  "גשם, שמש, שלג, סופה, רוח, ענן, ברק, רעם, חמסין, " +
  "טמפרטורות, לחות, מעונן, בהיר. מזג האוויר.";

const REPLACEMENTS: Array<[RegExp, string]> = [
  [/מאיז[הו]\s+[גה]?אוו?יר/g, "מזג האוויר"],
];

export function fixTranscript(text: string): string {
  if (!text) return text;
  let out = text;
  for (const [pattern, repl] of REPLACEMENTS) {
    out = out.replace(pattern, repl);
  }
  return out;
}
