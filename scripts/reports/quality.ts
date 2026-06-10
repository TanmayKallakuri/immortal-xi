/** Shared quality-summary builder used by export and the report script. */
import type Database from "better-sqlite3";
import type { QualitySummary } from "../../lib/types";

export function buildQualitySummary(sqlite: Database.Database): QualitySummary {
  const one = (sql: string): number => (sqlite.prepare(sql).get() as { n: number }).n;

  const flagsByType: Record<string, number> = {};
  for (const row of sqlite
    .prepare("SELECT flag_type, COUNT(*) n FROM data_quality_flags GROUP BY flag_type ORDER BY n DESC")
    .all() as Array<{ flag_type: string; n: number }>) {
    flagsByType[row.flag_type] = row.n;
  }

  const coverageByDecade: Record<string, number> = {};
  for (const row of sqlite
    .prepare(
      `SELECT (CAST(end_year / 10 AS INTEGER) * 10) || 's' AS decade, COUNT(*) n
       FROM seasons GROUP BY decade ORDER BY decade`,
    )
    .all() as Array<{ decade: string; n: number }>) {
    coverageByDecade[row.decade] = row.n;
  }

  const dist = (sql: string): Record<string, number> => {
    const out: Record<string, number> = {};
    for (const row of sqlite.prepare(sql).all() as Array<{ k: string; n: number }>) out[row.k] = row.n;
    return out;
  };
  const categoryDistribution = dist(
    "SELECT category k, COUNT(*) n FROM club_seasons GROUP BY category ORDER BY n DESC",
  );
  const draftableByCategory = dist(
    "SELECT category k, COUNT(*) n FROM club_seasons WHERE squad_complete = 1 GROUP BY category ORDER BY n DESC",
  );
  const draftableByEra = dist(
    `SELECT (CAST(s.end_year / 10 AS INTEGER) * 10) || 's' AS k, COUNT(*) n
     FROM club_seasons c JOIN seasons s ON s.id = c.season_id
     WHERE c.squad_complete = 1 GROUP BY k ORDER BY k`,
  );
  // strength bands mirror lib/draft/engine.ts bandOf(): S>=84, A>=78, B>=72, C below
  const strengthBands = dist(
    `SELECT CASE
       WHEN category = 'champion' THEN 'S (champion-grade)'
       WHEN category = 'runner_up' THEN 'A (finalist-grade)'
       WHEN category IN ('semi_finalist','quarter_finalist') THEN 'B (deep-run)'
       ELSE 'C (iconic/other)'
     END k, COUNT(*) n
     FROM club_seasons WHERE squad_complete = 1 GROUP BY k ORDER BY k`,
  );

  const blockedSources = sqlite
    .prepare("SELECT id, status_note FROM sources WHERE status = 'blocked'")
    .all() as Array<{ id: string; status_note: string }>;

  const incompleteSquads = one(
    "SELECT COUNT(*) n FROM club_seasons WHERE progression IN ('W','RU') AND squad_complete = 0",
  );
  const missingGk = one(
    "SELECT COUNT(*) n FROM club_seasons WHERE progression IN ('W','RU') AND has_goalkeeper = 0",
  );
  const lowConfidence = one("SELECT COUNT(*) n FROM player_seasons WHERE confidence_label = 'low'") +
    one("SELECT COUNT(*) n FROM club_seasons WHERE confidence_label = 'low' AND progression IN ('W','RU')");

  const nextCleanupTasks: string[] = [];
  if (incompleteSquads > 0) nextCleanupTasks.push(`${incompleteSquads} finalist squads incomplete — re-check parser against their pages`);
  if (missingGk > 0) nextCleanupTasks.push(`${missingGk} finalist squads without a goalkeeper`);
  const nameOnly = flagsByType["name-only-identity"] ?? 0;
  if (nameOnly > 0) nextCleanupTasks.push(`${nameOnly} players identified by name only — add wiki identity evidence`);
  const dupes = flagsByType["duplicate-candidate"] ?? 0;
  if (dupes > 0) nextCleanupTasks.push(`${dupes} duplicate candidates to review`);
  for (const b of blockedSources) nextCleanupTasks.push(`source ${b.id} blocked: ${b.status_note.slice(0, 90)}`);
  const squadListOnly = one(
    "SELECT COUNT(*) n FROM club_seasons WHERE squad_complete = 1 AND review_reason LIKE 'squad-list%'",
  );
  if (squadListOnly > 0) {
    nextCleanupTasks.push(
      `${squadListOnly} iconic teams carry squad-list evidence only — ingest per-player UCL stats to sharpen their ratings`,
    );
  }
  nextCleanupTasks.push("extend curated coverage: add more iconic non-finalists to data/curation/iconic-club-seasons.json");

  return {
    totalSeasons: one("SELECT COUNT(*) n FROM seasons"),
    totalClubs: one("SELECT COUNT(*) n FROM clubs"),
    totalClubSeasons: one("SELECT COUNT(*) n FROM club_seasons"),
    totalPlayers: one("SELECT COUNT(*) n FROM players"),
    totalPlayerSeasons: one("SELECT COUNT(*) n FROM player_seasons"),
    totalMatches: one("SELECT COUNT(*) n FROM matches"),
    totalGoals: one("SELECT COUNT(*) n FROM goals"),
    draftableClubSeasons: one("SELECT COUNT(*) n FROM club_seasons WHERE squad_complete = 1"),
    missingPositions: one("SELECT COUNT(*) n FROM player_seasons WHERE pos_inferred = 1"),
    missingGoalkeepers: missingGk,
    incompleteSquads,
    duplicateCandidates: dupes,
    lowConfidenceRecords: lowConfidence,
    manualOverrides: one("SELECT COUNT(*) n FROM manual_overrides"),
    blockedSources: blockedSources.length,
    flagsByType,
    coverageByDecade,
    categoryDistribution,
    draftableByCategory,
    draftableByEra,
    strengthBands,
    nextCleanupTasks,
  };
}
