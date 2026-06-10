import { describe, expect, it } from "vitest";
import {
  computeRatings,
  applyOverride,
  ratingsSane,
  contextBaseFor,
  maxPersonalEvidence,
  type RatingInputs,
} from "../lib/ratings/model";
import { TEAM_CONTEXT_SPREAD_CAP, DOMESTIC_TOTAL_CAP } from "../lib/ratings/config";

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

describe("rating model v3", () => {
  it("is deterministic", () => {
    expect(computeRatings(base)).toEqual(computeRatings({ ...base }));
  });

  it("stays within bounds for extreme inputs", () => {
    const extremes: RatingInputs[] = [
      { ...base, finalGoals: 9, careerFinals: 12, careerFinalWins: 10, captain: true },
      { ...base, role: "bench", teamTier: "RU", careerFinals: 1, careerFinalWins: 0, posGroup: "GK" },
      { ...base, posGroup: "DF", endYear: 2026 },
      { ...base, posGroup: "MF", endYear: 1956, confidenceScore: 0.2 },
      { ...base, role: "squad", teamTier: "SF", continentalApps: 60, continentalStarts: 60, continentalGoals: 40, leagueApps: 50, leagueGoals: 45 },
      { ...base, role: "squad", teamTier: "PART", continentalApps: 0, continentalGoals: 0, squadHasStats: true },
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
    const core = computeRatings({ ...base, role: "squad", teamTier: "SF", continentalApps: 12, continentalStarts: 12, continentalGoals: 6 });
    const fringe = computeRatings({ ...base, role: "squad", teamTier: "SF", continentalApps: 1, continentalGoals: 0 });
    expect(core.ratings.overall).toBeGreaterThan(fringe.ratings.overall);
    expect(core.ratings.overall - fringe.ratings.overall).toBeGreaterThanOrEqual(8);
  });

  it("production is position-specific: a forward's goals matter more than a defender's", () => {
    const fw = computeRatings({ ...base, posGroup: "FW", role: "squad", teamTier: "SF", continentalApps: 10, continentalGoals: 5 });
    const df = computeRatings({ ...base, posGroup: "DF", role: "squad", teamTier: "SF", continentalApps: 10, continentalGoals: 5 });
    expect(fw.ratings.overall).toBeGreaterThan(df.ratings.overall);
  });

  it("a breakout scorer on a semi-finalist lands in the star band (the Mbappé class)", () => {
    // ~Monaco 2016/17 Mbappé: 9 European apps, 6 goals, 29 league apps, 15 league goals
    const breakout = computeRatings({
      ...base,
      role: "squad",
      teamTier: "SF",
      continentalApps: 9,
      continentalStarts: 6,
      continentalGoals: 6,
      leagueApps: 29,
      leagueGoals: 15,
      endYear: 2017,
    });
    expect(breakout.ratings.overall).toBeGreaterThanOrEqual(82);
    expect(breakout.ratings.overall).toBeLessThanOrEqual(88);
  });

  it("true starters get the starts bonus; super-subs do not", () => {
    const starter = computeRatings({ ...base, role: "squad", teamTier: "SF", continentalApps: 12, continentalStarts: 11 });
    const superSub = computeRatings({ ...base, role: "squad", teamTier: "SF", continentalApps: 12, continentalStarts: 6 });
    expect(starter.ratings.overall).toBeGreaterThan(superSub.ratings.overall);
  });

  it("domestic same-season context is capped and cannot dominate", () => {
    const noDom = computeRatings({ ...base, role: "squad", teamTier: "SF", continentalApps: 8, continentalGoals: 2 });
    const hugeDom = computeRatings({
      ...base, role: "squad", teamTier: "SF", continentalApps: 8, continentalGoals: 2,
      leagueApps: 40, leagueGoals: 40,
    });
    expect(hugeDom.ratings.overall - noDom.ratings.overall).toBeLessThanOrEqual(DOMESTIC_TOTAL_CAP);
  });

  it("a player missing from a squad's existing stats table reads as uninvolved, not unknown", () => {
    const unknown = computeRatings({ ...base, role: "squad", teamTier: "SF", continentalApps: null, squadHasStats: false });
    const absent = computeRatings({ ...base, role: "squad", teamTier: "SF", continentalApps: null, squadHasStats: true });
    expect(absent.ratings.overall).toBeLessThan(unknown.ratings.overall);
  });

  it("era-scaled involvement: a 1970s core starter is not penalized for a shorter competition", () => {
    const modern = computeRatings({ ...base, role: "squad", teamTier: "SF", continentalApps: 9, continentalStarts: 9, endYear: 2017 });
    const old = computeRatings({ ...base, role: "squad", teamTier: "SF", continentalApps: 6, continentalStarts: 6, endYear: 1975 });
    // 6 apps in a ~9-match-to-win era counts like 9+ in the modern format
    expect(old.ratings.overall).toBeGreaterThanOrEqual(modern.ratings.overall - 1);
  });

  it("era does not punish old players", () => {
    const fifties = computeRatings({ ...base, endYear: 1956 }).ratings.overall;
    const modern = computeRatings({ ...base, endYear: 2025 }).ratings.overall;
    expect(fifties).toEqual(modern);
  });

  it("low confidence increases rarity and the uncertainty band, never lowers overall", () => {
    const sure = computeRatings({ ...base, confidenceScore: 0.95 });
    const archive = computeRatings({ ...base, confidenceScore: 0.5 });
    expect(archive.ratings.overall).toEqual(sure.ratings.overall);
    expect(archive.ratings.rarity).toBeGreaterThan(sure.ratings.rarity);
    expect(archive.explanation.uncertaintyBand).toBeGreaterThan(sure.explanation.uncertaintyBand);
  });

  it("overall never exceeds context base + personal evidence cap (no overrides)", () => {
    const roles = ["starter", "sub", "bench", "squad"] as const;
    const tiers = ["W", "RU", "SF", "QF", "R16", "GS", "PART"] as const;
    for (const role of roles) {
      for (const tier of tiers) {
        const { ratings } = computeRatings({
          ...base,
          role,
          teamTier: tier,
          finalGoals: 5,
          captain: true,
          continentalApps: 15,
          continentalStarts: 15,
          continentalGoals: 12,
          leagueApps: 40,
          leagueGoals: 30,
          careerFinals: 9,
          careerFinalWins: 9,
        });
        // +0.05: overall rounds to one decimal, so the cap can round up half a step
        expect(ratings.overall).toBeLessThanOrEqual(contextBaseFor(role, tier) + maxPersonalEvidence(role) + 0.05);
      }
    }
  });

  it("explanation carries every contribution for explainability", () => {
    const { explanation } = computeRatings({
      ...base, role: "squad", teamTier: "SF",
      continentalApps: 9, continentalStarts: 6, continentalGoals: 6, leagueApps: 29, leagueGoals: 15,
    });
    expect(explanation.contextBase).toBeGreaterThan(0);
    expect(explanation.involvementContribution).toBeGreaterThan(0);
    expect(explanation.productionContribution).toBeGreaterThan(0);
    expect(explanation.domesticContribution).toBeGreaterThan(0);
    expect(explanation.teamContextCapped).toBe(true);
    expect(explanation.confidenceLevel).toBeDefined();
  });

  it("overrides clamp and apply only known fields", () => {
    const { ratings } = computeRatings(base);
    const out = applyOverride(ratings, { overall: 120, attack: 99 });
    expect(out.overall).toBe(99);
    expect(out.attack).toBe(99);
    expect(out.defense).toEqual(ratings.defense);
  });
});
