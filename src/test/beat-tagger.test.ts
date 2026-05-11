import { describe, it, expect } from "vitest";
import {
  isClothingTag,
  isClothingText,
  isHotWeatherNarration,
  isColdWeatherNarration,
  isOvercastNarration,
  clothingClimateMismatch,
  depictsColdGarments,
  depictsHotGarments,
} from "@/server/pipeline/beat-tagger";

describe("isClothingTag / isClothingText", () => {
  it("recognises English clothing keywords", () => {
    expect(isClothingTag("coat")).toBe(true);
    expect(isClothingTag("jacket")).toBe(true);
    expect(isClothingTag("umbrella")).toBe(true);
    expect(isClothingTag("sunglasses")).toBe(true);
  });

  it("recognises Hebrew clothing keywords", () => {
    expect(isClothingText("מעיל")).toBe(true);
    expect(isClothingText("ביגוד")).toBe(true);
    expect(isClothingText("כובע")).toBe(true);
  });

  it("rejects non-clothing tags", () => {
    expect(isClothingTag("rain")).toBe(false);
    expect(isClothingTag("clouds")).toBe(false);
    expect(isClothingTag("aerial")).toBe(false);
  });

  it("handles embedded keyword in longer phrase", () => {
    // CLOTHING_KEYWORDS checked with matchesAny which looks for substring/set match
    expect(isClothingText("מומלץ ללבוש מעיל היום")).toBe(true);
  });
});

describe("isHotWeatherNarration", () => {
  it("detects hot weather phrases", () => {
    expect(isHotWeatherNarration("יום חם מאוד")).toBe(true);
    expect(isHotWeatherNarration("גל חום מתקרב")).toBe(true);
    expect(isHotWeatherNarration("טמפרטורות גבוהות")).toBe(true);
  });

  it("does not flag cold or neutral text", () => {
    expect(isHotWeatherNarration("גשם קל")).toBe(false);
    expect(isHotWeatherNarration("יום מעונן")).toBe(false);
  });
});

describe("isColdWeatherNarration", () => {
  it("detects cold weather phrases", () => {
    expect(isColdWeatherNarration("יום קר")).toBe(true);
    expect(isColdWeatherNarration("שלג בחרמון")).toBe(true);
  });

  it("does not flag hot or neutral text", () => {
    expect(isColdWeatherNarration("יום חם")).toBe(false);
  });
});

describe("isOvercastNarration", () => {
  it("detects overcast/cloudy phrases", () => {
    expect(isOvercastNarration("שמיים מעוננים")).toBe(true);
    expect(isOvercastNarration("עננים כבדים כיסו את השמיים")).toBe(true);
  });

  it("does not flag clear-sky text", () => {
    expect(isOvercastNarration("שמש זורחת")).toBe(false);
  });
});

describe("clothingClimateMismatch", () => {
  it("flags cold garments on a hot narration beat", () => {
    // Beat mentions heat, clip depicts coat — mismatch
    expect(clothingClimateMismatch("יום חם מאוד", "coat winter")).toBe(true);
  });

  it("flags hot garments on a cold narration beat", () => {
    expect(clothingClimateMismatch("שלג קר", "sandals summer")).toBe(true);
  });

  it("no mismatch when garment matches climate", () => {
    // cold beat + cold garment
    expect(clothingClimateMismatch("קר מאוד", "coat winter scarf")).toBe(false);
    // hot beat + hot garment
    expect(clothingClimateMismatch("חום כבד", "sandals summer")).toBe(false);
  });

  it("no mismatch on neutral beat text", () => {
    expect(clothingClimateMismatch("גשם קל", "coat")).toBe(false);
  });
});

describe("depictsColdGarments / depictsHotGarments", () => {
  it("identifies cold garments", () => {
    expect(depictsColdGarments("coat scarf gloves")).toBe(true);
    expect(depictsColdGarments("sandals summer")).toBe(false);
  });

  it("identifies hot garments", () => {
    expect(depictsHotGarments("sandals summer hat")).toBe(true);
    expect(depictsHotGarments("coat winter")).toBe(false);
  });
});
