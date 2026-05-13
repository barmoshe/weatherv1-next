import { describe, expect, it } from "vitest";
import {
  auditHebrewSegment,
  canonicalHebrewTag,
  inferConcepts,
  normalizeHebrewTags,
  targetContradictsSegment,
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
});
