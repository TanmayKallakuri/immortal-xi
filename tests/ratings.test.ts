import { describe, expect, it } from "vitest";
import { computeRatings, applyOverride, ratingsSane, contextBaseFor, type RatingInputs } from "../lib/ratings/model";
import { TEAM_CONTEXT_SPREAD_CAP, FINAL_GOAL_OVERALL_CAP, CAPTAIN_OVERALL } from "../lib/ratings/config";

const base: RatingInputs = {
  posGroup: "FW",
  role: "starter",
  teamTier: "W",
  finalGoals: 0,
  captain: false,
  careerFinals: 1,
  careerFinalWins: 1,
  endYear: 1960,
  confidenceScore: 0.9,
};

describe("rating model v2", () => {
  it("is deterministic", () => {
    expect(computeRatings(base)).toEqual(computeRatings({ ...base }));
  });

  it("stays within bounds for extreme inputs", () => {
    const extremes: RatingInputs[] = [
      { ...base, finalGoals: 9, careerFinals: 12, careerFinalWins: 10, captain: true },
      { ...base, role: "bench", teamTier: "RU", careerFinals: 1, careerFinalWins: 0, posGroup: "GK" },
      { ...base, posGroup: "DF", endYear: 2026 },
      { ...base, posGroup: "MF", endYear: 1956, confidenceScore: 0.2 },
      { ...base, role: "squad", teamTier: "SF", continentalApps: 60, continentalGoals: 40 },
      { ...base, role: "squad", teamTier: "PART", continentalApps: 0, continentalGoals: 0 },
    ];
    for (const inp of extremes) {
      const { ratings } = computeRatings(inp);
      expect(ratingsSane(ratings)).toEqual([]);
    }
  });

  it("REPEATED CAREER FINALS DO NOT TOUCH OVERALL — only aura/clutch", () => {
    const oneFinal = computeRatings({ ...base, careerFinals: 1, careerFinalWins: 0 });
    const dynasty = computeRatings({ ...base, careerFinals: 8, careerFinalWins: 6 });
    expect(dynasty.ratings.overall).toEqual(oneFinal.ratings.overall);
    expect(dynasty.ratings.attack).toEqual(oneFinal.ratings.attack);
    expect(dynasty.ratings.defense).toEqual(oneFinal.ratings.defense);
    expect(dynasty.ratings.uclAura).toBeGreaterThan(oneFinal.ratings.uclAura);
    expect(dynasty.explanation.careerExcludedFromOverall).toBe(true);
  });

  it("team achievement contribution to overall is capped", () => {
    for (const role of ["starter", "sub", "bench"] as const) {
      const w = computeRatings({ ...base, role, teamTier: "W" }).ratings.overall;
      const ru = computeRatings({ ...base, role, teamTier: "RU" }).ratings.overall;
      expect(w - ru).toBeLessThanOrEqual(TEAM_CONTEXT_SPREAD_CAP);
      expect(w - ru).toBeGreaterThanOrEqual(0);
    }
  });

  it("squad players cannot reach 90+ from team achievement alone", () => {
    for (const role of ["sub", "bench", "squad"] as const) {
      for (const tier of ["W", "RU", "SF", "QF"] as const) {
        const { ratings } = computeRatings({
          ...base,
          role,
          teamTier: tier,
          finalGoals: 0,
          continentalApps: null,
          continentalGoals: null,
          careerFinals: 10,
          careerFinalWins: 8,
        });
        expect(ratings.overall).toBeLessThan(90);
      }
    }
  });

  it("player-specific impact outranks generic team success", () => {
    // a decisive star on the LOSING side outranks a quiet starter on the winners
    const decisiveLoser = computeRatings({ ...base, teamTier: "RU", finalGoals: 2 });
    const quietWinner = computeRatings({ ...base, teamTier: "W", finalGoals: 0 });
    expect(decisiveLoser.ratings.overall).toBeGreaterThanOrEqual(quietWinner.ratings.overall);
  });

  it("same player rates differently across seasons with different evidence", () => {
    const quiet = computeRatings({ ...base, finalGoals: 0 });
    const heroic = computeRatings({ ...base, finalGoals: 2 });
    expect(heroic.ratings.overall).toBeGreaterThan(quiet.ratings.overall);
    expect(heroic.ratings.clutch).toBeGreaterThan(quiet.ratings.clutch);
  });

  it("continental season evidence separates core players from fringe", () => {
    const core = computeRatings({ ...base, role: "squad", teamTier: "SF", continentalApps: 12, continentalGoals: 6 });
    const fringe = computeRatings({ ...base, role: "squad", teamTier: "SF", continentalApps: 1, continentalGoals: 0 });
    expect(core.ratings.overall).toBeGreaterThan(fringe.ratings.overall);
    expect(core.ratings.overall - fringe.ratings.overall).toBeGreaterThanOrEqual(4);
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

  it("overall never exceeds context base + personal evidence cap (no overrides)", () => {
    const roles = ["starter", "sub", "bench", "squad"] as const;
    const tiers = ["W", "RU", "SF", "QF", "R16", "GS", "PART"] as const;
    const maxPersonal = FINAL_GOAL_OVERALL_CAP + CAPTAIN_OVERALL + 5 + 2; // + continental caps
    for (const role of roles) {
      for (const tier of tiers) {
        const { ratings } = computeRatings({
          ...base,
          role,
          teamTier: tier,
          finalGoals: 5,
          captain: true,
          continentalApps: 15,
          continentalGoals: 12,
          careerFinals: 9,
          careerFinalWins: 9,
        });
        expect(ratings.overall).toBeLessThanOrEqual(contextBaseFor(role, tier) + maxPersonal);
      }
    }
  });

  it("overrides clamp and apply only known fields", () => {
    const { ratings } = computeRatings(base);
    const out = applyOverride(ratings, { overall: 120, attack: 99 });
    expect(out.overall).toBe(99);
    expect(out.attack).toBe(99);
    expect(out.defense).toEqual(ratings.defense);
  });
});
