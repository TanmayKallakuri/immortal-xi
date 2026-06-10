/**
 * Mode-driven information visibility — the single source of truth for what
 * Classic and Hard Mode may show at each phase. Pure + tested.
 *
 * Both modes: team finish (champion/runner-up/semi-finalist labels, final
 * scores, opponent names) is HIDDEN during the draft and revealed only after
 * the XI is complete.
 *
 * Hard Mode additionally hides ratings and all advantage-giving stats during
 * the draft; the simulation still uses the real hidden ratings internally.
 */
import type { DraftMode } from "./engine";

export type GamePhase = "draft" | "review" | "result";

export interface VisibilityRules {
  /** champion/runner-up/semi-finalist labels, final scores, opponents */
  teamFinish: boolean;
  /** overall + category ratings, rating bars */
  ratings: boolean;
  /** goals in final, season apps/goals, career finals counts */
  stats: boolean;
  /** starter/sub/bench/squad role chips */
  role: boolean;
  /** captain marker */
  captain: boolean;
  /** data-confidence indicator */
  confidence: boolean;
  /** name, position, club, season, nationality — always visible */
  identity: true;
}

export function visibilityFor(mode: DraftMode, phase: GamePhase): VisibilityRules {
  if (phase !== "draft") {
    // after the XI is complete everything may be shown, in both modes
    return { teamFinish: true, ratings: true, stats: true, role: true, captain: true, confidence: true, identity: true };
  }
  if (mode === "hard") {
    return {
      teamFinish: false,
      ratings: false,
      stats: false,
      role: false,
      captain: false,
      confidence: false,
      identity: true,
    };
  }
  // classic: full player card EXCEPT how the team finished
  return { teamFinish: false, ratings: true, stats: true, role: true, captain: true, confidence: true, identity: true };
}

/** Era/competition context shown on the spun club-season card during the
 *  draft — never the finish. */
export function clubSeasonDraftContext(mode: DraftMode): { showConfidence: boolean } {
  return { showConfidence: mode === "classic" };
}
