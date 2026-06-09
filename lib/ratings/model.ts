/**
 * Player-season rating model. FORMULA_VERSION bumps on any change.
 *
 * Philosophy (see docs/RATINGS.md):
 * - Season-specific: the same player rates differently in 1960 vs 1964.
 * - Evidence-driven: every input below is observed in canonical data
 *   (role in the final, goals in the final, captaincy, career finals count).
 * - Cross-era normalized: a 1957 European Cup winner's starter and a 2024
 *   winner's starter share the same base. Sparse old data lowers CONFIDENCE,
 *   never the rating itself. Confidence feeds simulation variance.
 * - Explainable: computeRatings returns the weighted parts it used.
 * - Bounded: all outputs clamped to [40, 99].
 */

import type { PlayerRatings, PosGroup } from "../types";

export const FORMULA_VERSION = "1.0.0";

export interface RatingInputs {
  posGroup: PosGroup;
  role: "starter" | "sub" | "bench";
  progression: "W" | "RU";
  finalGoals: number;
  captain: boolean;
  careerFinals: number; // finals appeared in across the dataset (>=1)
  careerFinalWins: number;
  endYear: number;
  confidenceScore: number; // 0..1, NOT used to lower ratings — only rarity
}

export interface RatingExplanation {
  base: number;
  goalBonus: number;
  dynastyBonus: number;
  captainBonus: number;
  parts: Record<string, number>;
}

export const clamp = (v: number, lo = 40, hi = 99): number =>
  Math.max(lo, Math.min(hi, Math.round(v * 10) / 10));

const BASE: Record<string, number> = {
  "starter:W": 84,
  "starter:RU": 81,
  "sub:W": 79,
  "sub:RU": 77,
  "bench:W": 76,
  "bench:RU": 74,
};

export function computeRatings(inp: RatingInputs): { ratings: PlayerRatings; explanation: RatingExplanation } {
  const base = BASE[`${inp.role}:${inp.progression}`] ?? 74;
  const goalBonus = Math.min(5, inp.finalGoals * 2.5);
  const dynastyBonus = Math.min(6, Math.max(0, inp.careerFinals - 1) * 1.2 + inp.careerFinalWins * 0.8);
  const captainBonus = inp.captain ? 1 : 0;

  const overall = clamp(base + goalBonus * 0.6 + dynastyBonus + captainBonus);

  const g = inp.posGroup;
  const attack = clamp(
    g === "FW" ? overall + 4 + inp.finalGoals * 1.5
    : g === "MF" ? overall - 2 + inp.finalGoals * 1.5
    : g === "DF" ? overall - 12 + inp.finalGoals
    : 38,
  );
  const control = clamp(
    g === "MF" ? overall + 3
    : g === "FW" ? overall - 6
    : g === "DF" ? overall - 5
    : overall - 25,
  );
  const defense = clamp(
    g === "DF" ? overall + 4
    : g === "GK" ? overall - 2
    : g === "MF" ? overall - 8
    : overall - 20,
  );
  const physical = clamp(70 + (overall - 78) * 0.5 + (g === "DF" || g === "MF" ? 3 : 0));
  const goalkeeping = clamp(g === "GK" ? overall + 2 : 20);
  const clutch = clamp(65 + inp.finalGoals * 6 + inp.careerFinalWins * 3 + (inp.captain ? 2 : 0));
  const uclAura = clamp(60 + inp.careerFinals * 5 + inp.careerFinalWins * 4);

  // Rarity: how collectible the card feels. Older eras and champions are rarer;
  // low data confidence makes a pick *rarer* (a deep cut), never worse.
  const decade = Math.floor(inp.endYear / 10) * 10;
  const eraRarity =
    decade <= 1960 ? 80 : decade <= 1980 ? 70 : decade <= 1990 ? 60 : decade <= 2000 ? 52 : 45;
  const rarity = clamp(
    eraRarity + (inp.progression === "W" ? 5 : 0) + (inp.confidenceScore < 0.7 ? 5 : 0) + dynastyBonus,
  );

  return {
    ratings: { overall, attack, control, defense, physical, goalkeeping, clutch, uclAura, rarity },
    explanation: {
      base,
      goalBonus,
      dynastyBonus,
      captainBonus,
      parts: {
        role: base,
        finalGoals: goalBonus,
        dynasty: dynastyBonus,
        captaincy: captainBonus,
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
    else if (v < 40 || v > 99) problems.push(`${k}=${v} out of [40,99]`);
  }
  return problems;
}
