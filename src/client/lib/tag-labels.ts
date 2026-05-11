export const VALUE_LABELS: Record<string, string> = {
  // weather
  rain: "גשם", sun: "שמש", snow: "שלג", storm: "סופה",
  fog: "ערפל", clouds: "עננים", wind: "רוח",
  hail: "ברד",
  clear_sky: "שמיים בהירים", partly_cloudy: "מעונן חלקית", overcast: "מעונן",
  // scenery
  urban: "עירוני", nature: "טבע", sea: "ים", mountain: "הר",
  indoor: "פנים", aerial: "צילום רחפן",
  // people + wardrobe
  people: "אנשים", kids: "ילדים", crowd: "המון", clothing: "לבוש",
  // time / light
  day: "יום", night: "לילה", golden_hour: "שעת זהב",
  dawn: "זריחה", dusk: "בין ערביים", midday: "צהריים", evening: "ערב",
  morning: "בוקר", afternoon: "אחר הצהריים",
  // climate
  hot: "חם", warm: "חמים", mild: "מתון", cool: "קריר", cold: "קר",
  summer: "קיץ", winter: "חורף", inbetween: "ביניים", spring: "אביב", autumn: "סתיו",
  // region
  north: "צפון", center: "מרכז", south: "דרום",
  coast: "חוף", inland: "פנים הארץ",
  negev: "נגב", arava: "ערבה", golan: "גולן", galilee: "גליל",
  hermon: "חרמון", kinneret: "כנרת", "dead-sea": "ים המלח", eilat: "אילת",
  // vibes
  calm: "רגוע", dramatic: "דרמטי", gloomy: "קודר", cheerful: "עליז",
  // source
  getty: "Getty", artlist: "Artlist", whatsapp: "WhatsApp",
  original: "מקור (צולם בידינו)", other: "אחר",
};

export function labelFor(value: string): string {
  return VALUE_LABELS[value] ?? value;
}
