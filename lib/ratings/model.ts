/**
 * Player-season rating model v3. FORMULA_VERSION bumps on any change.
 *
 * Philosophy (see docs/RATINGS.md):
 * - SEASON-SPECIFIC: ratings describe one player-season, never a career.
 *   Career inputs (finals played across years) are firewalled into ucl_aura
 *   (+ a tiny clutch term) and CANNOT touch overall.
 * - EVIDENCE-FIRST, POSITION-SPECIFIC: a capped team-context base plus the
 *   player's own season — involvement (European apps/starts), production
 *   (European goals weighted by position), knockout/final impact, captaincy,
 *   and a low-capped same-season domestic context for breakout players.
 * - TEAM ACHIEVEMENT IS CAPPED: the only team input to overall is the
 *   context base tier, whose spread is capped by TEAM_CONTEXT_SPREAD_CAP —
 *   a squad player on a dominant team cannot outrank a decisive star.
 * - MISSING DATA IS UNCERTAINTY, NOT A NERF: sparse old data lowers
 *   CONFIDENCE (wider sim variance, higher rarity, explicit uncertainty
 *   band) — never the rating. The one documented inference: a player absent
 *   from a squad's existing stats table did not feature in Europe.
 * - EXPLAINABLE + BOUNDED: every output returns its weighted parts; all
 *   values clamp to [RATING_MIN, RATING_MAX]. All weights live in config.ts.
 */

import type { PlayerRatings, PosGroup } from "../types";
import * as W from "./config";

export const FORMULA_VERSION = "3.0.0";

export type EvidenceRole = "starter" | "sub" | "bench" | "squad";
export type TeamTier = "W" | "RU" | "SF" | "QF" | "R16" | "GS" | "PART";

export interface RatingInputs {
  posGroup: PosGroup;
  role: EvidenceRole;
  /** how far the club-season went (drives context base + modest clutch) */
  teamTier: TeamTier;
  /** goals in that season's final (player-season knockout evidence) */
  finalGoals: number;
  /** European appearances/starts/goals that season where the source carries them */
  continentalApps?: number | null;
  continentalStarts?: number | null;
  continentalGoals?: number | null;
  /** domestic league apps/goals that same season (capped context only) */
  leagueApps?: number | null;
  leagueGoals?: number | null;
  /** true when this player's squad has a per-player stats table — a missing
   *  row then means "did not feature in Europe", not "unknown" */
  squadHasStats?: boolean;
  captain: boolean;
  /** career-to-date pedigree — aura/clutch ONLY, never overall */
  careerFinals: number;
  careerFinalWins: number;
  endYear: number;
  confidenceScore: number; // 0..1 — rarity + sim variance + uncertainty band only
  /** curated tags of the club-season (rarity flavor only) */
  tags?: string[];
}

export interface RatingExplanation {
  contextBase: number;
  involvementContribution: number;
  productionContribution: number;
  knockoutContribution: number;
  domesticContribution: number;
  captainBonus: number;
  confidenceLevel: "high" | "medium" | "low";
  /** plausible ± spread implied by data confidence (display only) */
  uncertaintyBand: number;
  teamContextCapped: true;
  careerExcludedFromOverall: true;
  parts: Record<string, number>;
}

export const clamp = (v: number, lo = W.RATING_MIN, hi = W.RATING_MAX): number =>
  Math.max(lo, Math.min(hi, Math.round(v * 10) / 10));

export function contextBaseFor(role: EvidenceRole, tier: TeamTier): number {
  if (role === "squad") {
    const key = `squad:${tier}` as keyof typeof W.CONTEXT_BASE;
    return W.CONTEXT_BASE[key] ?? W.CONTEXT_BASE["squad:PART"];
  }
  const key = `${role}:${tier}` as keyof typeof W.CONTEXT_BASE;
  // finalist roles only exist with W/RU tiers; anything else falls back
  return W.CONTEXT_BASE[key] ?? W.CONTEXT_BASE["squad:PART"];
}

/** Involvement score from European apps/starts. Null apps = no evidence
 *  (0, unless the squad's stats table exists — then it means unused). */
export function involvementScore(inp: RatingInputs): number {
  const apps = inp.continentalApps ?? null;
  if (apps === null) {
    return inp.squadHasStats ? W.NO_STATS_IN_STATTED_SQUAD : 0;
  }
  const eraScale = inp.endYear < W.ERA_APPS_SCALE_BEFORE ? W.ERA_APPS_SCALE : 1;
  let score = 0;
  for (const [minApps, s] of W.INVOLVEMENT_TIERS) {
    if (apps >= Math.ceil(minApps * eraScale)) {
      score = s;
      break;
    }
  }
  const starts = inp.continentalStarts ?? null;
  if (
    starts !== null &&
    starts >= Math.ceil(W.INVOLVEMENT_STARTS_CORE * eraScale) &&
    apps > 0 &&
    starts / apps >= W.INVOLVEMENT_STARTS_RATIO
  ) {
    score += W.INVOLVEMENT_STARTS_BONUS;
  }
  return score;
}

/** Position-specific production score from European goals (rate-aware). */
export function productionScore(inp: RatingInputs): number {
  const goals = inp.continentalGoals ?? null;
  if (goals === null || goals <= 0) return 0;
  const w = W.PRODUCTION_GOAL_WEIGHT[inp.posGroup];
  const cap = W.PRODUCTION_CAP[inp.posGroup];
  let raw = goals * w;
  const apps = inp.continentalApps ?? null;
  if (
    apps !== null &&
    apps > 0 &&
    goals >= W.PRODUCTION_RATE_MIN_GOALS &&
    goals / apps >= W.PRODUCTION_RATE_THRESHOLD &&
    (inp.posGroup === "FW" || inp.posGroup === "MF")
  ) {
    raw += W.PRODUCTION_RATE_BONUS;
  }
  return Math.min(cap, raw);
}

/** Same-season domestic context: capped low, position-weighted. */
export function domesticScore(inp: RatingInputs): number {
  const goals = inp.leagueGoals ?? null;
  const apps = inp.leagueApps ?? null;
  if (goals === null && apps === null) return 0;
  let score = 0;
  if (goals !== null && goals > 0) {
    score += Math.min(W.DOMESTIC_GOALS_CAP, goals * W.DOMESTIC_GOAL_WEIGHT[inp.posGroup]);
  }
  if (apps !== null) {
    if (apps >= W.DOMESTIC_APPS_REGULAR) score += W.DOMESTIC_APPS_REGULAR_BONUS;
    else if (apps >= W.DOMESTIC_APPS_HALF) score += W.DOMESTIC_APPS_HALF_BONUS;
  }
  return Math.min(W.DOMESTIC_TOTAL_CAP, score);
}

export function computeRatings(inp: RatingInputs): { ratings: PlayerRatings; explanation: RatingExplanation } {
  const contextBase = contextBaseFor(inp.role, inp.teamTier);

  // lineup-evidence roles already encode involvement in the base; their
  // (rare) continental stats count at reduced weight
  const seasonScale = inp.role === "squad" ? 1 : W.FINALIST_SEASON_EVIDENCE_SCALE;
  const involvement = involvementScore(inp) * seasonScale;
  const production = productionScore(inp) * seasonScale;
  const domestic = domesticScore(inp) * seasonScale;

  const knockout = Math.min(W.FINAL_GOAL_OVERALL_CAP, inp.finalGoals * W.FINAL_GOAL_OVERALL);
  const captainBonus = inp.captain ? W.CAPTAIN_OVERALL : 0;

  // overall: capped team context + player-season evidence. NO career terms.
  const overall = clamp(contextBase + involvement + production + knockout + domestic + captainBonus);

  const g = inp.posGroup;
  const contGoals = inp.continentalGoals ?? 0;
  const leagueGoals = inp.leagueGoals ?? 0;
  const contApps = inp.continentalApps ?? null;

  const attack = clamp(
    g === "GK"
      ? W.ATTACK_GK_FLOOR
      : overall +
          W.ATTACK_TEMPLATE[g]! +
          (g !== "DF" ? inp.finalGoals * W.FINAL_GOAL_ATTACK : inp.finalGoals) +
          (g !== "DF" ? Math.min(6, contGoals * W.CONTINENTAL_GOAL_ATTACK) : 0) +
          (g !== "DF" ? Math.min(W.LEAGUE_GOAL_ATTACK_CAP, leagueGoals * W.LEAGUE_GOAL_ATTACK) : 0),
  );
  const control = clamp(overall + W.CONTROL_TEMPLATE[g]);
  const defense = clamp(
    overall +
      W.DEFENSE_TEMPLATE[g] +
      ((g === "DF" || g === "GK") && contApps !== null && contApps >= 8 ? W.DEFENSE_CORE_APPS_BONUS : 0),
  );
  const physical = clamp(
    W.PHYSICAL_BASE + (overall - 78) * W.PHYSICAL_SLOPE + (g === "DF" || g === "MF" ? W.PHYSICAL_DF_MF_BONUS : 0),
  );
  const goalkeeping = clamp(g === "GK" ? overall + W.GOALKEEPING_GK_BONUS : W.GOALKEEPING_OUTFIELD);

  // clutch: personal evidence first; champion/deep-run context modest; career tiny
  const clutch = clamp(
    W.CLUTCH_BASE +
      inp.finalGoals * W.CLUTCH_FINAL_GOAL +
      Math.min(8, contGoals * W.CONTINENTAL_GOAL_CLUTCH) +
      (inp.captain ? W.CLUTCH_CAPTAIN : 0) +
      (inp.teamTier === "W" ? W.CLUTCH_CHAMPION : 0) +
      (inp.teamTier === "RU" || inp.teamTier === "SF" ? W.CLUTCH_DEEP_RUN : 0) +
      Math.min(W.CLUTCH_CAREER_CAP, Math.max(0, inp.careerFinals - 1) * W.CLUTCH_CAREER_PER_EXTRA_FINAL),
  );

  // aura: the ONLY home of career pedigree
  const uclAura = clamp(
    Math.min(
      W.AURA_CAP,
      W.AURA_BASE + inp.careerFinals * W.AURA_PER_CAREER_FINAL + inp.careerFinalWins * W.AURA_PER_CAREER_WIN,
    ),
  );

  // rarity: era + champion + deep-archive + cult flavor (cosmetic)
  const eraRarity = W.RARITY_BY_DECADE.find(([until]) => inp.endYear <= until)?.[1] ?? 45;
  const cultTags = ["upset_team", "cult_team", "historic_giant_killer", "data_incomplete_but_iconic"];
  const rarity = clamp(
    eraRarity +
      (inp.teamTier === "W" ? W.RARITY_CHAMPION : 0) +
      (inp.confidenceScore < 0.7 ? W.RARITY_LOW_CONFIDENCE : 0) +
      ((inp.tags ?? []).some((t) => cultTags.includes(t)) ? W.RARITY_CULT_TAGS : 0),
  );

  const uncertaintyBand = Math.round((1 - Math.max(0, Math.min(1, inp.confidenceScore))) * W.UNCERTAINTY_BAND_MAX * 10) / 10;

  return {
    ratings: { overall, attack, control, defense, physical, goalkeeping, clutch, uclAura, rarity },
    explanation: {
      contextBase,
      involvementContribution: Math.round(involvement * 100) / 100,
      productionContribution: Math.round(production * 100) / 100,
      knockoutContribution: knockout,
      domesticContribution: Math.round(domestic * 100) / 100,
      captainBonus,
      confidenceLevel: inp.confidenceScore >= 0.8 ? "high" : inp.confidenceScore >= 0.65 ? "medium" : "low",
      uncertaintyBand,
      teamContextCapped: true,
      careerExcludedFromOverall: true,
      parts: {
        contextBase,
        involvement: Math.round(involvement * 100) / 100,
        production: Math.round(production * 100) / 100,
        finalGoals: knockout,
        domesticContext: Math.round(domestic * 100) / 100,
        captaincy: captainBonus,
        auraCareerFinals: inp.careerFinals * W.AURA_PER_CAREER_FINAL,
        auraCareerWins: inp.careerFinalWins * W.AURA_PER_CAREER_WIN,
        eraRarity,
      },
    },
  };
}

/** Maximum personal-evidence lift above the context base (audit ceiling). */
export function maxPersonalEvidence(role: EvidenceRole): number {
  const seasonScale = role === "squad" ? 1 : W.FINALIST_SEASON_EVIDENCE_SCALE;
  const invMax = (W.INVOLVEMENT_TIERS[0][1] + W.INVOLVEMENT_STARTS_BONUS) * seasonScale;
  const prodMax = Math.max(...Object.values(W.PRODUCTION_CAP)) * seasonScale;
  const domMax = W.DOMESTIC_TOTAL_CAP * seasonScale;
  return invMax + prodMax + domMax + W.FINAL_GOAL_OVERALL_CAP + W.CAPTAIN_OVERALL;
}

/** Apply a manual override (absolute values) on top of computed ratings. */
export function applyOverride(ratings: PlayerRatings, fields: Partial<PlayerRatings>): PlayerRatings {
  const out = { ...ratings };
  for (const [k, v] of Object.entries(fields)) {
    if (k in out && typeof v === "number") {
      (out as unknown as Record<string, number>)[k] = clamp(v);
    }
  }
  return out;
}

/** Sanity check used by the pipeline and tests. */
export function ratingsSane(r: PlayerRatings): string[] {
  const problems: string[] = [];
  for (const [k, v] of Object.entries(r)) {
    if (typeof v !== "number" || !Number.isFinite(v)) problems.push(`${k} not finite`);
    else if (v < W.RATING_MIN || v > W.RATING_MAX) problems.push(`${k}=${v} out of [${W.RATING_MIN},${W.RATING_MAX}]`);
  }
  return problems;
}
