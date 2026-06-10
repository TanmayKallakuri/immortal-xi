/**
 * Rating weights — the ENTIRE tunable surface of the rating model.
 * No magic constants live in model.ts; change values here and bump
 * FORMULA_VERSION in model.ts. See docs/RATINGS.md for rationale.
 *
 * Design rules encoded here (v2):
 *  - overall is built from PLAYER-SEASON evidence (role in that season's
 *    final, goals in that final, captaincy) on top of a context base.
 *  - the context base is the only team-achievement input to overall, and its
 *    total spread is capped (TEAM_CONTEXT_SPREAD_CAP guards it in tests).
 *  - career-level inputs (finals played across years) touch ONLY ucl_aura
 *    and (slightly) clutch — never overall.
 */

/** Context base by evidence tier. Spread within a role tier is the capped
 *  team-achievement contribution to overall. */
export const CONTEXT_BASE = {
  // finalists: per-final lineup evidence exists
  "starter:W": 84,
  "starter:RU": 81,
  "sub:W": 78,
  "sub:RU": 76,
  "bench:W": 75,
  "bench:RU": 73,
  // squad-list evidence only (curated iconic teams) — by how far the team got
  "squad:SF": 77,
  "squad:QF": 75,
  "squad:R16": 73,
  "squad:GS": 72,
  "squad:PART": 71,
} as const;

/** Hard cap on how much team achievement may separate two players with
 *  identical personal evidence and role. Tested. */
export const TEAM_CONTEXT_SPREAD_CAP = 4;

/** Personal season evidence */
export const FINAL_GOAL_OVERALL = 1.5; // per goal in that season's final, applied to overall
export const FINAL_GOAL_OVERALL_CAP = 4.5;
export const CAPTAIN_OVERALL = 1;

/** Continental season stats (squad-list teams with {{Efs player}} tables):
 *  importance within that specific team-season. */
export const CONTINENTAL_GOAL_OVERALL = 0.8; // per European goal that season
export const CONTINENTAL_GOAL_OVERALL_CAP = 5;
export const CONTINENTAL_APPS_CORE = 8; // apps at/above => core player
export const CONTINENTAL_APPS_CORE_BONUS = 2;
export const CONTINENTAL_APPS_ROTATION = 4; // 4..7 apps => rotation
export const CONTINENTAL_APPS_ROTATION_BONUS = 1;
export const CONTINENTAL_APPS_FRINGE_MAX = 1; // 0..1 apps => fringe
export const CONTINENTAL_APPS_FRINGE_PENALTY = -2.5;
export const CONTINENTAL_GOAL_ATTACK = 0.7; // extra attack per European goal (MF/FW)
export const CONTINENTAL_GOAL_CLUTCH = 1.2;

/** Subratings: position templates over overall */
export const ATTACK_TEMPLATE = { FW: 4, MF: -2, DF: -12, GK: null } as const; // null => fixed floor
export const ATTACK_GK_FLOOR = 38;
export const FINAL_GOAL_ATTACK = 1.5; // extra attack per final goal for MF/FW
export const CONTROL_TEMPLATE = { MF: 3, FW: -6, DF: -5, GK: -25 } as const;
export const DEFENSE_TEMPLATE = { DF: 4, GK: -2, MF: -8, FW: -20 } as const;
export const PHYSICAL_BASE = 70;
export const PHYSICAL_SLOPE = 0.5; // per point of overall above 78
export const PHYSICAL_DF_MF_BONUS = 3;
export const GOALKEEPING_GK_BONUS = 2;
export const GOALKEEPING_OUTFIELD = 20;

/** Clutch: personal first, team success modest, career pedigree tiny */
export const CLUTCH_BASE = 64;
export const CLUTCH_FINAL_GOAL = 6;
export const CLUTCH_CAPTAIN = 2;
export const CLUTCH_CHAMPION = 3; // modest team-success term (allowed by design)
export const CLUTCH_CAREER_PER_EXTRA_FINAL = 1;
export const CLUTCH_CAREER_CAP = 4;

/** Aura: the ONLY place career finals pedigree lives */
export const AURA_BASE = 58;
export const AURA_PER_CAREER_FINAL = 4;
export const AURA_PER_CAREER_WIN = 3;
export const AURA_CAP = 96;

/** Rarity (collectibility — affects nothing in simulation) */
export const RARITY_BY_DECADE: Array<[number, number]> = [
  [1960, 80],
  [1980, 70],
  [1990, 60],
  [2000, 52],
  [9999, 45],
];
export const RARITY_CHAMPION = 5;
export const RARITY_LOW_CONFIDENCE = 8; // deep archive picks are rarer, never worse
export const RARITY_CULT_TAGS = 6; // upset/cult/giant-killer curated teams

export const RATING_MIN = 40;
export const RATING_MAX = 99;
