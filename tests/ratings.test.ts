import { describe, expect, it } from "vitest";
import { computeRatings, applyOverride, ratingsSane, type RatingInputs } from "../lib/ratings/model";

const base: RatingInputs = {
  posGroup: "FW",
  role: "starter",
  progression: "W",
  finalGoals: 0,
  captain: false,
  careerFinals: 1,
  careerFinalWins: 1,
  endYear: 1960,
  confidenceScore: 0.9,
};

describe("ratings model", () => {
  it("is deterministic", () => {
    expect(computeRatings(base)).toEqual(computeRatings({ ...base }));
  });

  it("stays within bounds for extreme inputs", () => {
    const extremes: RatingInputs[] = [
      { ...base, finalGoals: 9, careerFinals: 12, careerFinalWins: 10, captain: true },
      { ...base, role: "bench", progression: "RU", careerFinals: 1, careerFinalWins: 0, posGroup: "GK" },
      { ...base, posGroup: "DF", endYear: 2026 },
      { ...base, posGroup: "MF", endYear: 1956, confidenceScore: 0.2 },
    ];
    for (const inp of extremes) {
      const { ratings } = computeRatings(inp);
      expect(ratingsSane(ratings)).toEqual([]);
    }
  });

  it("winner starters outrate losing bench players", () => {
    const a = computeRatings(base).ratings.overall;
    const b = computeRatings({ ...base, role: "bench", progression: "RU" }).ratings.overall;
    expect(a).toBeGreaterThan(b);
  });

  it("goals in the final boost attack and clutch", () => {
    const quiet = computeRatings(base).ratings;
    const hero = computeRatings({ ...base, finalGoals: 3 }).ratings;
    expect(hero.attack).toBeGreaterThan(quiet.attack);
    expect(hero.clutch).toBeGreaterThan(quiet.clutch);
  });

  it("dynasty players carry more aura", () => {
    const oneTime = computeRatings(base).ratings.uclAura;
    const dynasty = computeRatings({ ...base, careerFinals: 5, careerFinalWins: 5 }).ratings.uclAura;
    expect(dynasty).toBeGreaterThan(oneTime);
  });

  it("era does not punish old players", () => {
    const fifties = computeRatings({ ...base, endYear: 1956 }).ratings.overall;
    const modern = computeRatings({ ...base, endYear: 2025 }).ratings.overall;
    expect(fifties).toEqual(modern);
  });

  it("low confidence increases rarity, never lowers overall", () => {
    const sure = computeRatings({ ...base, confidenceScore: 0.95 }).ratings;
    const archive = computeRatings({ ...base, confidenceScore: 0.5 }).ratings;
    expect(archive.overall).toEqual(sure.overall);
    expect(archive.rarity).toBeGreaterThan(sure.rarity);
  });

  it("overrides clamp and apply only known fields", () => {
    const { ratings } = computeRatings(base);
    const out = applyOverride(ratings, { overall: 120, attack: 99 });
    expect(out.overall).toBe(99);
    expect(out.attack).toBe(99);
    expect(out.defense).toEqual(ratings.defense);
  });
});
