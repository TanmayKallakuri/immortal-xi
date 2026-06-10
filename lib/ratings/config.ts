/**
 * Rating weights — the ENTIRE tunable surface of the rating model.
 * No magic constants live in model.ts; change values here and bump
 * FORMULA_VERSION in model.ts. See docs/RATINGS.md for rationale.
 *
 * Design rules encoded here (v3):
 *  - overall = capped team-context base + PLAYER-SEASON evidence:
 *    involvement (European apps/starts), position-specific production
 *    (European goals weighted by position), knockout/final impact,
 *    same-season domestic context (capped low), captaincy.
 *  - the context base is the only team-achievement input to overall, and its
 *    total spread is capped (TEAM_CONTEXT_SPREAD_CAP guards it in tests).
 *  - career-level inputs (finals played across years) touch ONLY ucl_aura
 *    and (slightly) clutch — never overall.
 *  - missing data is uncertainty (confidence/rarity/variance), never an
 *    automatic nerf — EXCEPT when a squad's stats table exists and a player
 *    is absent from it, which is evidence of non-involvement.
 */

/** Context base by evidence tier. For lineup-evidence roles (finalists) the
 *  role already encodes involvement in the decisive match. For squad-list
 *  teams the base describes an AVERAGE squad member; involvement and
 *  production move individuals up or down from there. */
export const CONTEXT_BASE = {
  // finalists: per-final lineup evidence exists
  "starter:W": 84,
  "starter:RU": 81,
  "sub:W": 77.5,
  "sub:RU": 75.5,
  "bench:W": 74,
  "bench:RU": 72.5,
  // squad-list evidence only (curated iconic teams) — by how far the team got
  "squad:SF": 73,
  "squad:QF": 72,
  "squad:R16": 71,
  "squad:GS": 70,
  "squad:PART": 69,
} as const;

/** Hard cap on how much team achievement may separate two players with
 *  identical personal evidence and role. Tested. */
export const TEAM_CONTEXT_SPREAD_CAP = 4;

/** ---- Involvement: European apps/starts that season ----
 *  Tiers as [minApps, score], first match wins (descending minApps). */
export const INVOLVEMENT_TIERS: Array<[number, number]> = [
  [10, 5], // ever-present core
  [8, 4], // core
  [6, 2.5], // strong rotation
  [4, 1.5], // rotation
  [2, -1.5], // limited involvement
  [1, -4], // fringe
  [0, -6], // registered but unused in Europe
];
export const INVOLVEMENT_STARTS_CORE = 8; // starts at/above => undisputed starter
export const INVOLVEMENT_STARTS_RATIO = 0.7; // ...and most apps are starts (no super-subs)
export const INVOLVEMENT_STARTS_BONUS = 1;
/** lineup-evidence roles (starter/sub/bench) already carry involvement in the
 *  base, so continental involvement/production count at half weight there */
export const FINALIST_SEASON_EVIDENCE_SCALE = 0.5;
/** the squad's stats table exists but this player has no row in it:
 *  evidence of non-involvement in Europe (flagged, documented inference) */
export const NO_STATS_IN_STATTED_SQUAD = -5;
/** pre-group-stage European Cups were ~9 matches, not ~15: apps thresholds
 *  scale down for old eras so a 1970s core starter still reads as core */
export const ERA_APPS_SCALE_BEFORE = 1992;
export const ERA_APPS_SCALE = 0.6;

/** ---- Production: European goals, position-specific ---- */
export const PRODUCTION_GOAL_WEIGHT: Record<"GK" | "DF" | "MF" | "FW", number> = {
  FW: 1.0,
  MF: 0.85,
  DF: 0.5,
  GK: 0,
};
export const PRODUCTION_CAP: Record<"GK" | "DF" | "MF" | "FW", number> = {
  FW: 6,
  MF: 5,
  DF: 2.5,
  GK: 0,
};
/** elite scoring-rate bonus (inside the cap): needs real volume */
export const PRODUCTION_RATE_MIN_GOALS = 4;
export const PRODUCTION_RATE_THRESHOLD = 0.5; // goals per appearance
export const PRODUCTION_RATE_BONUS = 1;

/** ---- Knockout / final impact (personal season evidence) ---- */
export const FINAL_GOAL_OVERALL = 1.5; // per goal in that season's final
export const FINAL_GOAL_OVERALL_CAP = 4.5;
export const CAPTAIN_OVERALL = 1;

/** ---- Domestic same-season context (capped low; helps breakout players
 *  whose European-only sample is small — never career reputation) ---- */
export const DOMESTIC_GOAL_WEIGHT: Record<"GK" | "DF" | "MF" | "FW", number> = {
  FW: 0.15,
  MF: 0.12,
  DF: 0.05,
  GK: 0,
};
export const DOMESTIC_GOALS_CAP = 2;
export const DOMESTIC_APPS_REGULAR = 25; // established league starter
export const DOMESTIC_APPS_REGULAR_BONUS = 1;
export const DOMESTIC_APPS_HALF = 15;
export const DOMESTIC_APPS_HALF_BONUS = 0.5;
export const DOMESTIC_TOTAL_CAP = 2.5; // domestic context can never dominate

/** Subratings: position templates over overall */
export const ATTACK_TEMPLATE = { FW: 4, MF: -2, DF: -12, GK: null } as const; // null => fixed floor
export const ATTACK_GK_FLOOR = 38;
export const FINAL_GOAL_ATTACK = 1.5; // extra attack per final goal for MF/FW
export const CONTINENTAL_GOAL_ATTACK = 0.7; // extra attack per European goal (MF/FW)
export const LEAGUE_GOAL_ATTACK = 0.1; // small league-form trickle (MF/FW)
export const LEAGUE_GOAL_ATTACK_CAP = 2;
export const CONTROL_TEMPLATE = { MF: 3, FW: -6, DF: -5, GK: -25 } as const;
export const DEFENSE_TEMPLATE = { DF: 4, GK: -2, MF: -8, FW: -20 } as const;
export const DEFENSE_CORE_APPS_BONUS = 1.5; // DF/GK with core European involvement
export const PHYSICAL_BASE = 70;
export const PHYSICAL_SLOPE = 0.5; // per point of overall above 78
export const PHYSICAL_DF_MF_BONUS = 3;
export const GOALKEEPING_GK_BONUS = 2;
export const GOALKEEPING_OUTFIELD = 20;

/** Clutch: personal first, team success modest, career pedigree tiny */
export const CLUTCH_BASE = 64;
export const CLUTCH_FINAL_GOAL = 6;
export const CONTINENTAL_GOAL_CLUTCH = 1.2;
export const CLUTCH_CAPTAIN = 2;
export const CLUTCH_CHAMPION = 3; // modest team-success term (allowed by design)
export const CLUTCH_DEEP_RUN = 1.5; // SF/RU knockout pedigree that season
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

/** uncertainty band width (explainability only): points of plausible spread
 *  around overall at zero confidence */
export const UNCERTAINTY_BAND_MAX = 12;

export const RATING_MIN = 40;
export const RATING_MAX = 99;
