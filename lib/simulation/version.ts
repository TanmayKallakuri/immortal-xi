/** Simulation version. Bump on ANY change to simulation logic or tuning. */
export const SIM_VERSION = "4.0.0";

export const SIM_VERSION_NOTES: Record<string, string> = {
  "1.0.0": "Initial engine: Poisson xG match model, 36-team league phase, two-legged knockouts, H2H modes.",
  "1.1.0":
    "Fix: level-aggregate ties now decided by a true ET-only period + live shootout (1.0.0 could fall back to a fixed 4-3 result); leg results expose etGoals.",
  "2.0.0":
    "Role-aware slot-class position fits replace group-adjacency fits; assist attribution added to goal events; ratings formula v2 (season-evidence-first) changes all team strengths.",
  "3.0.0":
    "Strict cross-line position blocking with explicit multi-position support; player-named events (keepers, defenders, takers) with role-label fallbacks; kick-by-kick penalty shootouts for live reveal.",
  "4.0.0":
    "Stage-aware knockout opponent draw from the full historical pool (QF/SF/final escalate toward elite champions/finalists via STAGE_BANDS); evidence-blended teamStrength scale (champions reach the mid-90s); opponent sides take positional shape from their real squads; ratings formula v3 (position-specific player-season impact).",
};
