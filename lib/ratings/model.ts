/**
 * Player-season rating model v2. FORMULA_VERSION bumps on any change.
 *
 * Philosophy (see docs/RATINGS.md):
 * - SEASON-SPECIFIC: ratings describe one player-season, never a career.
 *   Career inputs (finals played across years) are firewalled into ucl_aura
 *   (+ a tiny clutch term) and CANNOT touch overall.
 * - EVIDENCE-FIRST: personal evidence in that season (started the final,
 *   goals in the final, captaincy) drives overall above the context base.
 * - TEAM ACHIEVEMENT IS CAPPED: the only team input to overall is the
 *   context base tier, whose spread is capped by TEAM_CONTEXT_SPREAD_CAP —
 *   a squad player on a dominant team cannot outrank a decisive star.
 * - CROSS-ERA NORMALIZED: a 1957 winner's starter and a 2024 winner's
 *   starter share the same base. Sparse old data lowers CONFIDENCE (wider
 *   sim variance, higher rarity), never the rating itself.
 * - EXPLAINABLE + BOUNDED: every output returns its weighted parts; all
 *   values clamp to [RATING_MIN, RATING_MAX]. All weights live in config.ts.
 */

import type { PlayerRatings, PosGroup } from "../types";
import * as W from "./config";

export const FORMULA_VERSION = "2.0.0";

export type EvidenceRole = "starter" | "sub" | "bench" | "squad";
export type TeamTier = "W" | "RU" | "SF" | "QF" | "R16" | "GS" | "PART";

export interface RatingInputs {
  posGroup: PosGroup;
  role: EvidenceRole;
  /** how far the club-season went (drives context base + modest clutch) */
  teamTier: TeamTier;
  /** goals in that season's final (player-season evidence) */
  finalGoals: number;
  /** European appearances/goals that season where the source carries them */
  continentalApps?: number | null;
  continentalGoals?: number | null;
  captain: boolean;
  /** career-to-date pedigree — aura/clutch ONLY, never overall */
  careerFinals: number;
  careerFinalWins: number;
  endYear: number;
  confidenceScore: number; // 0..1 — rarity + sim variance only
  /** curated tags of the club-season (rarity flavor only) */
  tags?: string[];
}

export interface RatingExplanation {
  contextBase: number;
  personalGoalBonus: number;
  captainBonus: number;
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

export function computeRatings(inp: RatingInputs): { ratings: PlayerRatings; explanation: RatingExplanation } {
  const contextBase = contextBaseFor(inp.role, inp.teamTier);
  const personalGoalBonus = Math.min(W.FINAL_GOAL_OVERALL_CAP, inp.finalGoals * W.FINAL_GOAL_OVERALL);
  const captainBonus = inp.captain ? W.CAPTAIN_OVERALL : 0;

  // continental season evidence: importance within that team-season
  const contGoals = inp.continentalGoals ?? null;
  const contApps = inp.continentalApps ?? null;
  const continentalGoalBonus =
    contGoals !== null ? Math.min(W.CONTINENTAL_GOAL_OVERALL_CAP, contGoals * W.CONTINENTAL_GOAL_OVERALL) : 0;
  const appsAdj =
    contApps === null
      ? 0
      : contApps >= W.CONTINENTAL_APPS_CORE
        ? W.CONTINENTAL_APPS_CORE_BONUS
        : contApps >= W.CONTINENTAL_APPS_ROTATION
          ? W.CONTINENTAL_APPS_ROTATION_BONUS
          : contApps <= W.CONTINENTAL_APPS_FRINGE_MAX
            ? W.CONTINENTAL_APPS_FRINGE_PENALTY
            : 0;

  // overall: context base + personal season evidence. NO career terms.
  const overall = clamp(contextBase + personalGoalBonus + captainBonus + continentalGoalBonus + appsAdj);

  const g = inp.posGroup;
  const attack = clamp(
    g === "GK"
      ? W.ATTACK_GK_FLOOR
      : overall +
          W.ATTACK_TEMPLATE[g]! +
          (g !== "DF" ? inp.finalGoals * W.FINAL_GOAL_ATTACK : inp.finalGoals) +
          (g !== "DF" && contGoals ? Math.min(6, contGoals * W.CONTINENTAL_GOAL_ATTACK) : 0),
  );
  const control = clamp(overall + W.CONTROL_TEMPLATE[g]);
  const defense = clamp(overall + W.DEFENSE_TEMPLATE[g]);
  const physical = clamp(
    W.PHYSICAL_BASE + (overall - 78) * W.PHYSICAL_SLOPE + (g === "DF" || g === "MF" ? W.PHYSICAL_DF_MF_BONUS : 0),
  );
  const goalkeeping = clamp(g === "GK" ? overall + W.GOALKEEPING_GK_BONUS : W.GOALKEEPING_OUTFIELD);

  // clutch: personal evidence first; champion context modest; career tiny
  const clutch = clamp(
    W.CLUTCH_BASE +
      inp.finalGoals * W.CLUTCH_FINAL_GOAL +
      (contGoals ? Math.min(8, contGoals * W.CONTINENTAL_GOAL_CLUTCH) : 0) +
      (inp.captain ? W.CLUTCH_CAPTAIN : 0) +
      (inp.teamTier === "W" ? W.CLUTCH_CHAMPION : 0) +
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

  return {
    ratings: { overall, attack, control, defense, physical, goalkeeping, clutch, uclAura, rarity },
    explanation: {
      contextBase,
      personalGoalBonus,
      captainBonus,
      careerExcludedFromOverall: true,
      parts: {
        contextBase,
        finalGoals: personalGoalBonus,
        continentalGoals: continentalGoalBonus,
        continentalApps: appsAdj,
        captaincy: captainBonus,
        auraCareerFinals: inp.careerFinals * W.AURA_PER_CAREER_FINAL,
        auraCareerWins: inp.careerFinalWins * W.AURA_PER_CAREER_WIN,
        eraRarity,
      },
    },
  };
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
