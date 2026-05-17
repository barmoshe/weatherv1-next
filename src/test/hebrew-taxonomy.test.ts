import { describe, expect, it } from "vitest";
import {
  auditHebrewSegment,
  canonicalHebrewTag,
  inferConcepts,
  normalizeHebrewTags,
  targetContradictsSegment,
  weatherClassMismatch,
} from "@/server/catalog/hebrew-taxonomy";

describe("Hebrew catalog taxonomy", () => {
  it("maps legacy English tags into Hebrew canonical tags", () => {
    expect(canonicalHebrewTag("clear_sky")).toBe("שמיים בהירים");
    expect(canonicalHebrewTag("hot")).toBe("חם");
    expect(normalizeHebrewTags(["sun", "day", "urban", "sun"])).toEqual([
      "שמש",
      "יום",
      "עירוני",
    ]);
  });

  it("infers abstract heat concepts from hot dry descriptions", () => {
    const concepts = inferConcepts({
      description: "מדבר צחיח תחת שמש חזקה ביום חם",
      tags: ["שמיים בהירים", "חם", "שמש", "יום", "טבע"],
    });
    expect(concepts.weather).toContain("חם");
    expect(concepts.season_mood).toContain("קיצי");
    expect(concepts.scene_fit).toContain("שרב");
    expect(concepts.scene_fit).toContain("קרינת שמש");
  });

  it("audits English tags and missing concepts", () => {
    const issues = auditHebrewSegment({
      id: "A-s0",
      start_sec: 0,
      end_sec: 5,
      description: "x",
      tags: ["clear_sky"],
    });
    expect(issues.some((issue) => issue.includes("non-hebrew"))).toBe(true);
    expect(issues).toContain("missing concepts");
  });

  it("rejects winter/autumn material for heatwave scenes", () => {
    expect(
      targetContradictsSegment("שרב כבד ועומס חום", {
        description: "עלי שלכת על שביל ביום קריר",
        tags: ["יום", "טבע"],
        concepts: {
          weather: ["מעונן"],
          season_mood: ["סתווי"],
          visual_role: ["רקע כללי", "טבע"],
          scene_fit: ["טמפרטורות"],
          avoid_for: ["שרב"],
        },
      }),
    ).toBe(true);
  });

  describe("weatherClassMismatch (categorical, tag-first)", () => {
    // Real production case: heat-wave scene swapped to a snow segment whose
    // ENGLISH tags ([snow, winter, cold, ...]) bypassed the contradict check.
    it("rejects an English-tagged snow segment for a Hebrew heat-wave scene", () => {
      const target = "אנחנו לקראת אכבדה בגל החום, ראשון ושני הימים החמים של השבוע";
      const segment = {
        tags: ["snow", "day", "winter", "cold", "urban", "nature", "north", "gloomy"],
        description: "שלג יורד על בית וצמחייה בשכונה צפונית קרה.",
      };
      expect(weatherClassMismatch(target, segment)).toBe(true);
    });

    it("rejects a calm sunset / golden-hour segment for a dangerous-waves scene", () => {
      const target = "גלים גבוהים בים, מסוכן לרחצה, רחצה רק בחופים עם שירותי הצלה";
      const segment = {
        tags: ["clear_sky", "sunset", "aerial", "sea", "calm"],
        description: "שמש שוקעת מעל הים בשעת זהב",
      };
      expect(weatherClassMismatch(target, segment)).toBe(true);
    });

    it("rejects a sunny-summer segment for a cold/rain scene", () => {
      const target = "היום מעונן חלקית עם טפטוף בצפון, קור ימשיך";
      const segment = {
        tags: ["sunny", "summer", "heat", "clear_sky"],
        description: "שדה חמניות פורח תחת שמיים בהירים בקיץ חם",
      };
      expect(weatherClassMismatch(target, segment)).toBe(true);
    });

    it("does NOT reject a thematically compatible pick", () => {
      const target = "גל החום בשפלה ובביקה";
      const segment = {
        tags: ["heat", "summer", "desert", "clear_sky"],
        description: "מבט אווירי על מדבר תחת שמש קיצית",
      };
      expect(weatherClassMismatch(target, segment)).toBe(false);
    });

    it("returns false when target is empty (no signal — let other gates decide)", () => {
      expect(weatherClassMismatch("", { tags: ["snow"] })).toBe(false);
    });

    it("rejects a sunset / dusk / golden-hour clip for a midday-style narration (Phase D)", () => {
      // Real failure: 'Eilat sunset hotels' got picked for 'מזג האוויר מתייצב'.
      const target = "מזג האוויר מתייצב ומתחיל שבוע בהיר";
      const segment = {
        tags: ["clear_sky", "day", "aerial", "sea", "sunset", "eilat", "south"],
        description: "מבט אווירי על מלונות אילת והים בשעת שקיעה זהובה",
      };
      expect(weatherClassMismatch(target, segment)).toBe(true);
    });

    it("ALLOWS a sunset clip when the narration mentions evening / sunset", () => {
      const target = "בשעות הערב צפויות רוחות חזקות";
      const segment = {
        tags: ["sunset", "sea", "calm"],
        description: "שקיעה בים",
      };
      expect(weatherClassMismatch(target, segment)).toBe(false);
    });
  });
});
