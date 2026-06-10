/**
 * EXPORT: canonical layer -> game-ready data.
 *
 *   npm run export-game-data
 *
 * - computes player-season ratings (lib/ratings/model.ts), persists them to
 *   the ratings table with their explanation JSON
 * - applies manual overrides (visible in the data report, never silent)
 * - derives club-season team strength for the opponent pool
 * - writes public/game-data.json consumed by the app runtime
 */
import fs from "node:fs";
import path from "node:path";
import { openDb } from "../../db";
import * as t from "../../db/schema";
import { computeRatings, applyOverride, ratingsSane, FORMULA_VERSION } from "../../lib/ratings/model";
import { eraLabel } from "../../lib/identity/normalize";
import { fingerprint, hash32 } from "../../lib/rng";
import type { GameClubSeason, GameData, GamePlayerSeason, PlayerRatings, SourceSummary } from "../../lib/types";

async function main() {
  const { db, sqlite } = openDb();

  const clubs = db.select().from(t.clubs).all();
  const clubById = new Map(clubs.map((c) => [c.id, c]));
  const seasons = db.select().from(t.seasons).all();
  const seasonById = new Map(seasons.map((s) => [s.id, s]));
  const clubSeasons = db.select().from(t.clubSeasons).all();
  const playerSeasons = db.select().from(t.playerSeasons).all();
  const players = db.select().from(t.players).all();
  const playerById = new Map(players.map((p) => [p.id, p]));
  const matches = db.select().from(t.matches).all();
  const overrides = db.select().from(t.manualOverrides).all();
  const sources = db.select().from(t.sources).all();
  const sourceRecords = db.select().from(t.sourceRecords).all();

  // ---- career finals per player (lineup evidence only — squad-list
  //      membership is not "played a final") ----
  const csById = new Map(clubSeasons.map((c) => [c.id, c]));
  const careerFinals = new Map<string, { n: number; wins: number }>();
  for (const ps of playerSeasons) {
    if (ps.role === "squad") continue;
    const cs = csById.get(ps.clubSeasonId);
    if (!cs || (cs.progression !== "W" && cs.progression !== "RU")) continue;
    const cur = careerFinals.get(ps.playerId) ?? { n: 0, wins: 0 };
    cur.n++;
    if (cs.progression === "W") cur.wins++;
    careerFinals.set(ps.playerId, cur);
  }

  // ---- ratings ----
  sqlite.exec("DELETE FROM ratings;");
  const overrideByPs = new Map<string, Record<string, number>>();
  for (const o of overrides) {
    if (o.entityType === "player_season_rating") {
      overrideByPs.set(o.entityId, JSON.parse(o.fieldsChanged));
    }
  }

  // squads whose stats table covers >=8 players: a missing stats row there
  // is evidence of non-involvement, not missing data
  const statRowsByCs = new Map<string, number>();
  for (const ps of playerSeasons) {
    if (ps.continentalApps !== null) {
      statRowsByCs.set(ps.clubSeasonId, (statRowsByCs.get(ps.clubSeasonId) ?? 0) + 1);
    }
  }
  const squadHasStats = (csId: string) => (statRowsByCs.get(csId) ?? 0) >= 8;

  const gamePlayerSeasons: GamePlayerSeason[] = [];
  const exportedPsByClubSeason = new Map<string, string[]>();
  let suspicious = 0;

  const insertRating = sqlite.prepare(
    `INSERT INTO ratings (player_season_id, overall, attack, control, defense, physical, goalkeeping,
     clutch, ucl_aura, rarity, formula_version, override_applied, explanation)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  );

  for (const ps of playerSeasons) {
    const cs = csById.get(ps.clubSeasonId);
    if (!cs || !cs.squadComplete) continue; // only draftable squads carry players into the game
    const season = seasonById.get(cs.seasonId)!;
    const career = careerFinals.get(ps.playerId) ?? { n: ps.role === "squad" ? 0 : 1, wins: 0 };
    const tags = JSON.parse(cs.tags || "[]") as string[];

    const { ratings: computed, explanation } = computeRatings({
      posGroup: ps.posGroup as "GK" | "DF" | "MF" | "FW",
      role: ps.role as "starter" | "sub" | "bench" | "squad",
      teamTier: cs.progression as "W" | "RU" | "SF" | "QF" | "R16" | "GS" | "PART",
      finalGoals: ps.finalGoals,
      continentalApps: ps.continentalApps,
      continentalStarts: ps.continentalStarts,
      continentalGoals: ps.continentalGoals,
      leagueApps: ps.leagueApps,
      leagueGoals: ps.leagueGoals,
      squadHasStats: squadHasStats(ps.clubSeasonId),
      captain: ps.captain,
      careerFinals: career.n,
      careerFinalWins: career.wins,
      endYear: season.endYear,
      confidenceScore: ps.confidenceScore,
      tags,
    });

    const ov = overrideByPs.get(ps.id);
    const ratings: PlayerRatings = ov ? applyOverride(computed, ov as Partial<PlayerRatings>) : computed;
    const problems = ratingsSane(ratings);
    if (problems.length) {
      suspicious++;
      console.warn(`suspicious ratings for ${ps.id}: ${problems.join("; ")}`);
    }

    insertRating.run(
      ps.id, ratings.overall, ratings.attack, ratings.control, ratings.defense, ratings.physical,
      ratings.goalkeeping, ratings.clutch, ratings.uclAura, ratings.rarity,
      FORMULA_VERSION, ov ? 1 : 0, JSON.stringify(explanation),
    );

    const player = playerById.get(ps.playerId)!;
    gamePlayerSeasons.push({
      id: ps.id,
      playerId: ps.playerId,
      name: player.name,
      clubSeasonId: ps.clubSeasonId,
      pos: ps.pos,
      positions: (() => {
        try {
          const arr = JSON.parse(ps.positions || "[]") as string[];
          return arr.length ? arr : [ps.pos];
        } catch {
          return [ps.pos];
        }
      })(),
      posGroup: ps.posGroup as GamePlayerSeason["posGroup"],
      shirt: ps.shirt,
      nationality: ps.nationality,
      captain: ps.captain,
      role: ps.role as GamePlayerSeason["role"],
      finalGoals: ps.finalGoals,
      seasonApps: ps.continentalApps,
      seasonGoals: ps.continentalGoals,
      seasonStarts: ps.continentalStarts,
      leagueApps: ps.leagueApps,
      leagueGoals: ps.leagueGoals,
      careerFinals: career.n,
      careerFinalWins: career.wins,
      ratings,
      confidence: { score: ps.confidenceScore, label: ps.confidenceLabel as "high" | "medium" | "low" },
      flags: ps.needsReview && ps.reviewReason ? [ps.reviewReason] : [],
      overrideApplied: !!ov,
    });
    const list = exportedPsByClubSeason.get(ps.clubSeasonId) ?? [];
    list.push(ps.id);
    exportedPsByClubSeason.set(ps.clubSeasonId, list);
  }

  // ---- club-season strength: CATEGORY base + squad-evidence quality ----
  // The category base sets the historical-tier anchor (expanded scale so the
  // very best club-seasons reach the mid-90s); the quality term moves a
  // club-season relative to the AVERAGE squad of its own category, so a
  // stacked champion separates from an ordinary one without era bias.
  const STRENGTH_BY_CATEGORY: Record<string, number> = {
    champion: 88,
    runner_up: 84,
    semi_finalist: 80,
    quarter_finalist: 76,
    round_of_16: 73,
    group_stage: 70,
    group_stage_iconic: 72,
    league_phase_iconic: 72,
    participant: 66,
  };
  // top-11 average overall per squad, then per-category means for normalization
  const gamePsById = new Map(gamePlayerSeasons.map((p) => [p.id, p]));
  const topAvgByCs = new Map<string, number>();
  for (const [csId, ids] of exportedPsByClubSeason) {
    const overalls = ids
      .map((id) => gamePsById.get(id)?.ratings.overall ?? 0)
      .sort((a, b) => b - a)
      .slice(0, 11);
    if (overalls.length === 11) {
      topAvgByCs.set(csId, overalls.reduce((s, v) => s + v, 0) / 11);
    }
  }
  const categoryTopAvgs = new Map<string, number[]>();
  for (const cs of clubSeasons) {
    const avg = topAvgByCs.get(cs.id);
    if (avg !== undefined) {
      categoryTopAvgs.set(cs.category, [...(categoryTopAvgs.get(cs.category) ?? []), avg]);
    }
  }
  const categoryMean = new Map<string, number>();
  for (const [cat, avgs] of categoryTopAvgs) {
    if (avgs.length >= 3) categoryMean.set(cat, avgs.reduce((s, v) => s + v, 0) / avgs.length);
  }
  const strengthFor = (cs: (typeof clubSeasons)[number]): number => {
    const jitter = (hash32(cs.id) % 5) - 2; // -2..+2, stable per club-season
    const base = STRENGTH_BY_CATEGORY[cs.category] ?? 66;
    const tags = JSON.parse(cs.tags || "[]") as string[];
    const eyeTest = tags.includes("high_xg_or_eye_test_team") ? 2 : 0;
    const topAvg = topAvgByCs.get(cs.id);
    const catMean = categoryMean.get(cs.category);
    const quality =
      topAvg !== undefined && catMean !== undefined
        ? Math.max(-3, Math.min(6, (topAvg - catMean) * 1.2))
        : 0;
    return Math.max(60, Math.min(96, Math.round(base + quality + eyeTest + jitter)));
  };

  const gameClubSeasons: GameClubSeason[] = [];
  for (const cs of clubSeasons) {
    const club = clubById.get(cs.clubId);
    const season = seasonById.get(cs.seasonId);
    if (!club || !season) continue;
    const psIds = exportedPsByClubSeason.get(cs.id) ?? [];
    const isFinalist = cs.progression === "W" || cs.progression === "RU";
    const opponentName =
      isFinalist
        ? (() => {
            // the other finalist that season
            const other = clubSeasons.find(
              (o) => o.seasonId === cs.seasonId && o.id !== cs.id && (o.progression === "W" || o.progression === "RU"),
            );
            return other ? (clubById.get(other.clubId)?.name ?? "") : "";
          })()
        : "";
    gameClubSeasons.push({
      id: cs.id,
      clubId: cs.clubId,
      clubName: club.name,
      country: club.country,
      season: cs.seasonId,
      year: season.endYear,
      eraLabel: eraLabel(season.endYear),
      competition: season.competitionId as "EC" | "UCL",
      progression: cs.progression,
      category: cs.category,
      tags: JSON.parse(cs.tags || "[]") as string[],
      finalScore: cs.finalScore ?? "",
      opponentClubName: opponentName,
      teamStrength: strengthFor(cs),
      confidence: { score: cs.confidenceScore, label: cs.confidenceLabel as "high" | "medium" | "low" },
      flags: cs.reviewReason ? [cs.reviewReason] : [],
      playerSeasonIds: psIds,
    });
  }

  // ---- source summaries ----
  const recordCounts = new Map<string, number>();
  for (const r of sourceRecords) {
    recordCounts.set(r.sourceId, (recordCounts.get(r.sourceId) ?? 0) + 1);
  }
  const sourceSummaries: SourceSummary[] = sources.map((s) => ({
    id: s.id,
    name: s.name,
    url: s.url,
    dataType: s.dataType,
    license: s.licenseNote,
    redistributable: s.redistributable,
    usage: s.internalDerivationOnly ? "internal derivation only" : "derived factual records",
    status: s.status as SourceSummary["status"],
    statusNote: s.statusNote,
    recordCount: recordCounts.get(s.id) ?? 0,
    retrievedAt: s.retrievedAt,
  }));

  // ---- quality summary (shared with the report script) ----
  const { buildQualitySummary } = await import("../reports/quality");
  const quality = buildQualitySummary(sqlite);

  const draftable = gameClubSeasons.filter((c) => c.playerSeasonIds.length >= 11);
  const core = {
    clubSeasons: gameClubSeasons,
    playerSeasons: gamePlayerSeasons,
    sources: sourceSummaries,
  };
  const dataVersion = "d" + fingerprint(JSON.stringify(core));
  const gameData: GameData = {
    dataVersion,
    generatedAt: new Date().toISOString(),
    ...core,
    quality,
  };

  const outPath = path.join(process.cwd(), "public", "game-data.json");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(gameData), "utf8");

  console.log(`EXPORT complete (ratings ${FORMULA_VERSION}, data ${dataVersion})`);
  console.log(`  draftable club-seasons: ${draftable.length}`);
  console.log(`  opponent-pool club-seasons: ${gameClubSeasons.length}`);
  console.log(`  exported player-seasons: ${gamePlayerSeasons.length}`);
  console.log(`  overrides applied: ${gamePlayerSeasons.filter((p) => p.overrideApplied).length}`);
  console.log(`  suspicious ratings: ${suspicious}`);
  console.log(`  -> ${path.relative(process.cwd(), outPath)} (${(fs.statSync(outPath).size / 1024).toFixed(0)} KB)`);
  sqlite.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
