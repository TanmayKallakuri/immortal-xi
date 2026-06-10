/** Shared domain types used by the pipeline, the engines, and the UI. */

export type PosGroup = "GK" | "DF" | "MF" | "FW";

export type ConfidenceLabel = "high" | "medium" | "low";

export interface Confidence {
  score: number; // 0..1
  label: ConfidenceLabel;
}

export interface PlayerRatings {
  overall: number;
  attack: number;
  control: number;
  defense: number;
  physical: number;
  goalkeeping: number;
  clutch: number;
  uclAura: number;
  rarity: number; // 0..100, how rare/collectible this pick is
}

/** One row of the game-ready export: a player in a specific club-season. */
export interface GamePlayerSeason {
  id: string; // player_season_id, e.g. "ps-alfredo-di-stefano-1960"
  playerId: string;
  name: string;
  clubSeasonId: string;
  pos: string; // primary historical position code as sourced: GK, RB, CB, IR, OL, CM...
  /** ALL explicitly sourced position codes (primary first). Eligibility uses
   *  the union of these; secondary roles are never invented from the group. */
  positions: string[];
  posGroup: PosGroup;
  shirt: number | null;
  nationality: string | null; // flag code from source, e.g. "ESP"
  captain: boolean;
  /** evidence tier: lineup roles for finalists, "squad" for squad-list teams */
  role: "starter" | "sub" | "bench" | "squad";
  finalGoals: number;
  /** European appearances/goals that season, where the source carries them */
  seasonApps: number | null;
  seasonGoals: number | null;
  careerFinals: number; // finals this player appears in across the dataset
  careerFinalWins: number;
  ratings: PlayerRatings;
  confidence: Confidence;
  flags: string[];
  overrideApplied: boolean;
}

/** One draftable historical club-season. */
export interface GameClubSeason {
  id: string; // team_season_id, e.g. "cs-real-madrid-1959-60"
  clubId: string;
  clubName: string;
  country: string | null;
  season: string; // "1959-60"
  year: number; // season end year, 1960
  eraLabel: string; // "1950s" ... "2020s"
  competition: "EC" | "UCL";
  /** how far this club-season went: W | RU | SF | QF | R16 | GS | PART */
  progression: string;
  /** factual/curated category: champion, runner_up, semi_finalist,
   *  quarter_finalist, round_of_16, group_stage, group_stage_iconic,
   *  league_phase_iconic, participant, ... */
  category: string;
  /** curated flavor tags: upset_team, cult_team, high_xg_or_eye_test_team,
   *  historic_giant_killer, domestic_legend_in_europe, collapse_iconic,
   *  data_incomplete_but_iconic */
  tags: string[];
  finalScore: string;
  opponentClubName: string;
  teamStrength: number; // 0..100 derived band for opponents/draft weighting
  confidence: Confidence;
  flags: string[];
  playerSeasonIds: string[];
}

export interface SourceSummary {
  id: string;
  name: string;
  url: string;
  dataType: string;
  license: string;
  redistributable: boolean;
  usage: string;
  status: "ok" | "blocked" | "registered";
  statusNote: string;
  recordCount: number;
  retrievedAt: string | null;
}

export interface QualitySummary {
  totalSeasons: number;
  totalClubs: number;
  totalClubSeasons: number;
  totalPlayers: number;
  totalPlayerSeasons: number;
  totalMatches: number;
  totalGoals: number;
  draftableClubSeasons: number;
  missingPositions: number;
  missingGoalkeepers: number;
  incompleteSquads: number;
  duplicateCandidates: number;
  lowConfidenceRecords: number;
  manualOverrides: number;
  blockedSources: number;
  flagsByType: Record<string, number>;
  coverageByDecade: Record<string, number>;
  /** all club-seasons by category */
  categoryDistribution: Record<string, number>;
  /** draftable club-seasons by category */
  draftableByCategory: Record<string, number>;
  /** draftable club-seasons by era */
  draftableByEra: Record<string, number>;
  /** draftable club-seasons by strength band (S/A/B/C) */
  strengthBands: Record<string, number>;
  nextCleanupTasks: string[];
}

export interface GameData {
  dataVersion: string;
  generatedAt: string;
  clubSeasons: GameClubSeason[];
  playerSeasons: GamePlayerSeason[];
  sources: SourceSummary[];
  quality: QualitySummary;
}
