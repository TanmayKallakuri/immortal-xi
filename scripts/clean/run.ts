/**
 * CLEAN: derive the canonical layer from raw payloads.
 *
 *   npm run clean
 *
 * Reads data/raw/**, never mutates it. Rebuilds all canonical tables from
 * scratch (idempotent). Every anomaly becomes a data_quality_flag; nothing
 * is guessed or fabricated.
 */
import fs from "node:fs";
import path from "node:path";
import { openDb, CANONICAL_TABLES, DDL } from "../../db";
import * as t from "../../db/schema";
import { loadRaw, listRaw, PARSER_VERSION } from "../ingest/framework";
import { parseFinalsList, parseFinalPage, parseSquadPage, type LineupBlock } from "./parsers";
import {
  resolveClub,
  resolvePlayer,
  posToGroup,
  normalizeSeason,
  slugify,
  clubMatchKey,
} from "../../lib/identity/normalize";

const now = () => new Date().toISOString();

interface FlagInput {
  entityType: string;
  entityId: string;
  flagType: string;
  severity: "info" | "warn" | "error";
  detail: string;
}

async function main() {
  const { db, sqlite } = openDb();

  // Rebuild canonical layer from scratch (raw layer untouched). Tables are
  // dropped + recreated so schema changes apply without migrations — the
  // canonical layer is a derived artifact, not a stateful store.
  for (const tbl of CANONICAL_TABLES) sqlite.exec(`DROP TABLE IF EXISTS ${tbl};`);
  sqlite.exec(DDL);

  const flags: FlagInput[] = [];
  const flag = (f: FlagInput) => flags.push(f);

  db.insert(t.competitions)
    .values([
      { id: "EC", name: "European Cup", firstSeason: "1955-56", lastSeason: "1991-92" },
      { id: "UCL", name: "UEFA Champions League", firstSeason: "1992-93", lastSeason: null },
    ])
    .run();

  // ---------- finals list ----------
  const finalsRaw = loadRaw("wikipedia-finals-list", "List of European Cup and UEFA Champions League finals");
  if (!finalsRaw) {
    console.error("No finals-list raw payload. Run `npm run ingest` first.");
    process.exit(1);
  }
  const finalsListRecordId = `wikipedia-finals-list:${slugify(finalsRaw.recordKey)}`;
  const { rows: finalRows, anomalies: listAnomalies } = parseFinalsList(finalsRaw.payload);
  for (const a of listAnomalies) {
    flag({ entityType: "source", entityId: "wikipedia-finals-list", flagType: "parse-anomaly", severity: "warn", detail: a });
  }

  // ---------- canonical registries ----------
  const clubRows = new Map<string, { id: string; name: string; country: string | null; matchedVia: string }>();
  const clubAliasSet = new Set<string>();
  const clubAliasRows: Array<{ clubId: string; alias: string; sourceRecordId: string }> = [];
  const playerRows = new Map<string, { id: string; name: string; nationality: string | null; identityEvidence: string; wikiTitle: string | null }>();
  const playerAliasRows: Array<{ playerId: string; alias: string; sourceRecordId: string }> = [];
  const playerSeasonRows: Array<typeof t.playerSeasons.$inferInsert> = [];
  const clubSeasonRows: Array<typeof t.clubSeasons.$inferInsert> = [];
  const seasonRows: Array<typeof t.seasons.$inferInsert> = [];
  const roundRows: Array<typeof t.rounds.$inferInsert> = [];
  const matchRows: Array<typeof t.matches.$inferInsert> = [];
  const appearanceRows: Array<typeof t.appearances.$inferInsert> = [];
  const goalRows: Array<typeof t.goals.$inferInsert> = [];
  const squadRows: Array<{ clubSeasonId: string; playerSeasonId: string }> = [];

  const registerClub = (raw: string, sourceRecordId: string) => {
    const res = resolveClub(raw);
    if (!clubRows.has(res.clubId)) {
      clubRows.set(res.clubId, {
        id: res.clubId,
        name: res.canonicalName,
        country: res.country,
        matchedVia: res.matchedVia,
      });
      if (res.matchedVia === "fallback") {
        flag({
          entityType: "club", entityId: res.clubId, flagType: "club-fallback-normalization",
          severity: "info", detail: `"${raw}" not in curated alias map; auto-canonicalized`,
        });
      }
    }
    const aliasKey = `${res.clubId}::${raw}`;
    if (!clubAliasSet.has(aliasKey)) {
      clubAliasSet.add(aliasKey);
      clubAliasRows.push({ clubId: res.clubId, alias: raw, sourceRecordId });
    }
    return res;
  };

  // player-season ids already created this run: playerId -> per-season
  const playerSeasonIndex = new Map<string, string>(); // `${playerId}@${clubSeasonId}` -> psId

  // careerFinals computed later from playerSeasonRows.

  let matchCounter = 0;

  for (const row of finalRows) {
    const seasonNorm = normalizeSeason(row.seasonRaw);
    if (!seasonNorm) {
      flag({ entityType: "season", entityId: row.seasonRaw, flagType: "bad-season-format", severity: "error", detail: row.seasonRaw });
      continue;
    }
    const { seasonId, endYear } = seasonNorm;
    seasonRows.push({
      id: seasonId,
      competitionId: row.competition,
      endYear,
      finalVenue: row.venueText,
      finalAttendance: row.attendance,
      sourceRecordId: finalsListRecordId,
      confidenceScore: 0.95,
      needsReview: false,
    });
    roundRows.push({ id: `${seasonId}:final`, seasonId, name: "final", ordinal: 100 });

    const winner = registerClub(row.winnerLink, finalsListRecordId);
    const runnerUp = registerClub(row.runnerUpLink, finalsListRecordId);

    const csWinnerId = `cs-${winner.clubId}-${seasonId}`;
    const csRunnerUpId = `cs-${runnerUp.clubId}-${seasonId}`;

    // ---------- final page: lineups, match, goals ----------
    const finalRecordKey = row.finalPage;
    const pageRaw = loadRaw("wikipedia-final-pages", finalRecordKey);
    const pageRecordId = pageRaw ? `wikipedia-final-pages:${slugify(pageRaw.recordKey)}` : null;

    let blocksByClub = new Map<string, LineupBlock[]>(); // clubId -> blocks
    let parsedOk = false;
    let pageAnomalies: string[] = [];

    if (!pageRaw) {
      flag({
        entityType: "club_season", entityId: csWinnerId, flagType: "missing-final-page",
        severity: "error", detail: `raw payload for "${row.finalPage}" not ingested`,
      });
    } else {
      const parsed = parseFinalPage(pageRaw.payload);
      pageAnomalies = parsed.anomalies;
      parsedOk = parsed.anomalies.length === 0;
      for (const a of parsed.anomalies) {
        flag({ entityType: "season", entityId: seasonId, flagType: "parse-anomaly", severity: "warn", detail: `${row.finalPage}: ${a}` });
      }

      // Attribute lineup blocks to the two finalists.
      // Kit templates appear either side-by-side before both lineups (classic
      // layout) or interleaved with them (modern layout); in BOTH layouts the
      // document order pairs kit i%2 with lineup block i%2.
      const winnerKeys = new Set([clubMatchKey(row.winnerLink), clubMatchKey(row.winnerDisplay)]);
      const runnerKeys = new Set([clubMatchKey(row.runnerUpLink), clubMatchKey(row.runnerUpDisplay)]);
      // Map football box team order to winner/runner-up for the order fallback.
      let team1ClubId = winner.clubId;
      let team2ClubId = runnerUp.clubId;
      const firstBox = parsed.matches[0];
      if (firstBox?.team1Link) {
        const t1 = resolveClub(firstBox.team1Link).clubId;
        if (t1 === runnerUp.clubId) {
          team1ClubId = runnerUp.clubId;
          team2ClubId = winner.clubId;
        }
      }
      const matchToFinalist = (label: string | null): string | null => {
        if (!label) return null;
        const key = clubMatchKey(label);
        const resolved = resolveClub(label).clubId;
        if (winnerKeys.has(key) || resolved === winner.clubId) return winner.clubId;
        if (runnerKeys.has(key) || resolved === runnerUp.clubId) return runnerUp.clubId;
        return null;
      };
      parsed.lineups.forEach((block, i) => {
        let target = matchToFinalist(block.kitTitle);
        if (!target) {
          target = i % 2 === 0 ? team1ClubId : team2ClubId;
          flag({
            entityType: "club_season",
            entityId: `cs-${target}-${seasonId}`,
            flagType: "lineup-attributed-by-order",
            severity: "info",
            detail: `${row.finalPage}: lineup block ${i} not matched to a kit title; attributed by document order`,
          });
        }
        pushBlock(blocksByClub, target, block);
      });

      // Matches + goals (a replayed final yields two match rows).
      for (const m of parsed.matches) {
        if (!m.score) continue;
        matchCounter++;
        const matchId = `m-${seasonId}-final${parsed.matches.length > 1 ? `-${matchCounter}` : ""}`;
        const t1Club = m.team1Link ? resolveClub(m.team1Link).clubId : team1ClubId;
        const t2Club = m.team2Link ? resolveClub(m.team2Link).clubId : team2ClubId;
        const [g1, g2] = m.score.split("–").map((n) => parseInt(n, 10));
        matchRows.push({
          id: matchId,
          roundId: `${seasonId}:final`,
          seasonId,
          date: m.date,
          homeClubSeasonId: `cs-${t1Club}-${seasonId}`,
          awayClubSeasonId: `cs-${t2Club}-${seasonId}`,
          homeGoals: g1,
          awayGoals: g2,
          extraTime: m.extraTime,
          penalties: m.penaltyScore,
          venue: m.stadium,
          sourceRecordId: pageRecordId,
        });
        for (const g of m.goals) {
          const forClub = g.team === 1 ? t1Club : t2Club;
          const scorerClub = g.ownGoal ? (g.team === 1 ? t2Club : t1Club) : forClub;
          const resolvedScorer = resolvePlayer(g.scorerLink, g.scorerDisplay);
          goalRows.push({
            matchId,
            playerSeasonId: `ps-${resolvedScorer.playerId.slice(2)}-${endYear}`, // linked after squads built; validated below
            scorerName: resolvedScorer.displayName,
            minute: g.minute,
            penalty: g.penalty,
            ownGoal: g.ownGoal,
            forClubSeasonId: `cs-${forClub}-${seasonId}`,
          });
          void scorerClub;
        }
      }
    }

    // ---------- club-seasons + player-seasons ----------
    for (const [clubId, progression] of [
      [winner.clubId, "W"],
      [runnerUp.clubId, "RU"],
    ] as const) {
      const csId = `cs-${clubId}-${seasonId}`;
      const blocks = blocksByClub.get(clubId) ?? [];
      // Merge duplicate players across blocks (replays list lineups twice).
      const merged = new Map<string, ReturnType<typeof mergePlayer>>();
      for (const block of blocks) {
        for (const lp of block.players) {
          const rp = resolvePlayer(lp.linkTarget, lp.displayName);
          const existing = merged.get(rp.playerId);
          merged.set(rp.playerId, mergePlayer(existing, lp, rp));
        }
      }

      // If parsing produced more than 11 "starters" (e.g. an unused-sub table
      // without a Substitutes header), keep the first 11 and demote the rest.
      let starterSeen = 0;
      for (const p of merged.values()) {
        if (p.isStarter) {
          starterSeen++;
          if (starterSeen > 11) p.isStarter = false;
        }
      }
      const starters = [...merged.values()].filter((p) => p.isStarter);
      const hasGk = [...merged.values()].some((p) => posToGroup(p.pos).group === "GK");
      const squadComplete = starters.length >= 11 && hasGk;

      if (merged.size === 0) {
        flag({ entityType: "club_season", entityId: csId, flagType: "missing-squad", severity: "error", detail: `no lineup parsed from ${row.finalPage}` });
      } else {
        if (starters.length !== 11) {
          flag({ entityType: "club_season", entityId: csId, flagType: "starter-count", severity: "warn", detail: `${starters.length} starters parsed (expected 11)` });
        }
        if (!hasGk) {
          flag({ entityType: "club_season", entityId: csId, flagType: "missing-goalkeeper", severity: "error", detail: "no GK in parsed squad" });
        }
      }

      let csConfidence = 0.55;
      if (merged.size > 0) csConfidence = 0.7;
      if (squadComplete) csConfidence = 0.85;
      if (squadComplete && parsedOk) csConfidence = 0.92;

      clubSeasonRows.push({
        id: csId,
        clubId,
        seasonId,
        progression,
        finalScore: row.scoreText,
        squadComplete,
        starterCount: starters.length,
        playerCount: merged.size,
        hasGoalkeeper: hasGk,
        confidenceScore: csConfidence,
        confidenceLabel: csConfidence >= 0.8 ? "high" : csConfidence >= 0.65 ? "medium" : "low",
        needsReview: !squadComplete,
        reviewReason: squadComplete ? null : "squad incomplete or unparsed",
        sourceRecordId: pageRecordId ?? finalsListRecordId,
      });

      for (const p of merged.values()) {
        // global player registry
        if (!playerRows.has(p.playerId)) {
          playerRows.set(p.playerId, {
            id: p.playerId,
            name: p.displayName,
            nationality: p.nationality,
            identityEvidence: p.identityEvidence,
            wikiTitle: p.linkTarget,
          });
          if (p.identityEvidence === "name-only") {
            flag({
              entityType: "player", entityId: p.playerId, flagType: "name-only-identity",
              severity: "warn", detail: `no wikilink for "${p.displayName}" — duplicate risk`,
            });
          }
        } else {
          const known = playerRows.get(p.playerId)!;
          if (known.name !== p.displayName) {
            playerAliasRows.push({ playerId: p.playerId, alias: p.displayName, sourceRecordId: pageRecordId ?? finalsListRecordId });
          }
        }

        const psId = `ps-${p.playerId.slice(2)}-${endYear}`;
        const psKey = `${p.playerId}@${csId}`;
        if (playerSeasonIndex.has(psKey)) {
          flag({
            entityType: "player_season", entityId: psId, flagType: "duplicate-in-squad",
            severity: "warn", detail: `${p.displayName} appears twice in ${csId}; merged`,
          });
          continue;
        }
        // Same player at *two different clubs* in one season would collide on psId:
        const collision = playerSeasonRows.find((r) => r.id === psId);
        if (collision) {
          flag({
            entityType: "player_season", entityId: psId, flagType: "duplicate-candidate",
            severity: "warn",
            detail: `${p.displayName} already has a player-season this season at ${collision.clubSeasonId}; check identity`,
          });
          continue;
        }
        playerSeasonIndex.set(psKey, psId);

        const posRes = posToGroup(p.pos);
        const role = p.isStarter ? "starter" : p.cameOn ? "sub" : "bench";
        let psConf = csConfidence;
        if (p.identityEvidence === "name-only") psConf *= 0.8;
        if (!posRes.confident) psConf *= 0.9;

        playerSeasonRows.push({
          id: psId,
          playerId: p.playerId,
          clubSeasonId: csId,
          pos: p.pos,
          positions: JSON.stringify([p.pos]),
          posGroup: posRes.group,
          posInferred: !posRes.confident,
          shirt: p.shirt,
          nationality: p.nationality,
          captain: p.captain,
          role,
          finalGoals: 0, // filled from goals below
          confidenceScore: Math.round(psConf * 100) / 100,
          confidenceLabel: psConf >= 0.8 ? "high" : psConf >= 0.65 ? "medium" : "low",
          needsReview: p.identityEvidence === "name-only" || !posRes.confident,
          reviewReason:
            p.identityEvidence === "name-only"
              ? "identity from name only"
              : !posRes.confident
                ? `position code ${p.pos} ambiguous`
                : null,
          sourceRecordId: pageRecordId ?? finalsListRecordId,
        });
        squadRows.push({ clubSeasonId: csId, playerSeasonId: psId });
        if (!posRes.confident) {
          flag({
            entityType: "player_season", entityId: psId, flagType: "position-inferred",
            severity: "info", detail: `code ${p.pos} mapped to ${posRes.group} with low confidence`,
          });
        }
      }
    }
  }

  // ---------- link goals to player-seasons; fill finalGoals ----------
  const psIds = new Set(playerSeasonRows.map((r) => r.id));
  const finalGoalsByPs = new Map<string, number>();
  for (const g of goalRows) {
    if (g.playerSeasonId && psIds.has(g.playerSeasonId)) {
      if (!g.ownGoal) {
        finalGoalsByPs.set(g.playerSeasonId, (finalGoalsByPs.get(g.playerSeasonId) ?? 0) + 1);
      }
    } else {
      flag({
        entityType: "goal", entityId: g.scorerName, flagType: "scorer-not-in-squad",
        severity: "info",
        detail: `scorer "${g.scorerName}" (${g.matchId}) not matched to a parsed squad member`,
      });
      g.playerSeasonId = null;
    }
  }
  for (const ps of playerSeasonRows) {
    ps.finalGoals = finalGoalsByPs.get(ps.id) ?? 0;
  }

  // ---------- appearances (final matches only, from lineups) ----------
  const matchBySeason = new Map<string, string[]>();
  for (const m of matchRows) {
    const list = matchBySeason.get(m.seasonId) ?? [];
    list.push(m.id);
    matchBySeason.set(m.seasonId, list);
  }
  for (const ps of playerSeasonRows) {
    const seasonId = ps.clubSeasonId!.slice(-7);
    const matchIds = matchBySeason.get(seasonId) ?? [];
    for (const mid of matchIds) {
      appearanceRows.push({
        matchId: mid,
        playerSeasonId: ps.id!,
        started: ps.role === "starter",
        cameOn: ps.role === "sub",
        minuteOn: null,
        minuteOff: null,
      });
    }
  }

  // ---------- footballcsv: breadth matches (non-finalist club-seasons) ----------
  const csvRaws = listRaw("footballcsv-cl");
  const seasonIds = new Set(seasonRows.map((s) => s.id));
  const clubSeasonIds = new Set(clubSeasonRows.map((c) => c.id));
  let csvMatches = 0;
  for (const raw of csvRaws) {
    const seasonFromPath = raw.recordKey.match(/(\d{4})-(\d{2})/);
    if (!seasonFromPath) continue;
    const norm = normalizeSeason(`${seasonFromPath[1]}-${seasonFromPath[2]}`);
    if (!norm || !seasonIds.has(norm.seasonId)) continue;
    const recordId = `footballcsv-cl:${slugify(raw.recordKey)}`;
    const lines = raw.payload.split("\n").map((l) => l.trim()).filter(Boolean);
    const header = (lines[0] ?? "").toLowerCase();
    const cols = header.split(",").map((c) => c.trim());
    const idx = {
      round: cols.findIndex((c) => c.includes("round") || c === "stage"),
      team1: cols.findIndex((c) => c === "team 1" || c === "team1" || c === "home"),
      team2: cols.findIndex((c) => c === "team 2" || c === "team2" || c === "away"),
      score: cols.findIndex((c) => c === "ft" || c === "score"),
      date: cols.findIndex((c) => c === "date"),
    };
    if (idx.team1 === -1 || idx.team2 === -1 || idx.score === -1) {
      flag({ entityType: "source", entityId: recordId, flagType: "parse-anomaly", severity: "warn", detail: `unrecognized CSV header: ${header}` });
      continue;
    }
    for (let i = 1; i < lines.length; i++) {
      const cells = lines[i].split(",").map((c) => c.trim());
      const score = (cells[idx.score] ?? "").match(/(\d+)\s*[–-]\s*(\d+)/);
      if (!score) continue;
      // footballcsv team cells look like "Sporting CP › POR (1)"
      const cleanTeam = (cell: string) =>
        cell.split("›")[0].replace(/\s*\([A-Za-z0-9]+\)\s*$/, "").trim();
      const t1Name = cleanTeam(cells[idx.team1] ?? "");
      const t2Name = cleanTeam(cells[idx.team2] ?? "");
      if (!t1Name || !t2Name) continue;
      const c1 = registerClub(t1Name, recordId);
      const c2 = registerClub(t2Name, recordId);
      const roundName = (idx.round >= 0 ? cells[idx.round] || "unknown" : "unknown").split("|")[0].trim();
      const roundId = `${norm.seasonId}:${slugify(roundName)}`;
      if (!roundRows.some((r) => r.id === roundId)) {
        roundRows.push({ id: roundId, seasonId: norm.seasonId, name: roundName, ordinal: 0 });
      }
      for (const c of [c1, c2]) {
        const csId = `cs-${c.clubId}-${norm.seasonId}`;
        if (!clubSeasonIds.has(csId)) {
          clubSeasonIds.add(csId);
          clubSeasonRows.push({
            id: csId,
            clubId: c.clubId,
            seasonId: norm.seasonId,
            progression: "PART",
            finalScore: null,
            squadComplete: false,
            starterCount: 0,
            playerCount: 0,
            hasGoalkeeper: false,
            confidenceScore: 0.6,
            confidenceLabel: "low",
            needsReview: false,
            reviewReason: "participant from match data only (no squad)",
            sourceRecordId: recordId,
          });
        }
      }
      csvMatches++;
      matchRows.push({
        id: `m-csv-${norm.seasonId}-${csvMatches}`,
        roundId,
        seasonId: norm.seasonId,
        date: idx.date >= 0 ? cells[idx.date] || null : null,
        homeClubSeasonId: `cs-${c1.clubId}-${norm.seasonId}`,
        awayClubSeasonId: `cs-${c2.clubId}-${norm.seasonId}`,
        homeGoals: parseInt(score[1], 10),
        awayGoals: parseInt(score[2], 10),
        extraTime: false,
        penalties: null,
        venue: null,
        sourceRecordId: recordId,
      });
    }
  }

  // ---------- curated iconic club-seasons ----------
  // Enrichment (category/tags) for teams that already have squads, plus full
  // squad ingestion from Wikipedia club-season articles for iconic
  // non-finalists. Curation lives in data/curation/iconic-club-seasons.json.
  const PROGRESSION_BY_CATEGORY: Record<string, string> = {
    champion: "W",
    runner_up: "RU",
    semi_finalist: "SF",
    quarter_finalist: "QF",
    round_of_16: "R16",
    group_stage_iconic: "GS",
    league_phase_iconic: "GS",
  };
  const curationPath = path.join(process.cwd(), "data", "curation", "iconic-club-seasons.json");
  let curatedSquads = 0;
  let curatedEnriched = 0;
  if (fs.existsSync(curationPath)) {
    const curation = JSON.parse(fs.readFileSync(curationPath, "utf8")) as {
      entries: Array<{
        club: string;
        season: string;
        category: string;
        tags: string[];
        squadPage?: string;
        note?: string;
        sourceRef?: string;
      }>;
    };
    for (const entry of curation.entries) {
      const norm = normalizeSeason(entry.season);
      if (!norm) {
        flag({ entityType: "curation", entityId: entry.club, flagType: "bad-season-format", severity: "error", detail: entry.season });
        continue;
      }
      const club = registerClub(entry.club, "curation:iconic-club-seasons");
      const csId = `cs-${club.clubId}-${norm.seasonId}`;
      const existing = clubSeasonRows.find((c) => c.id === csId);

      if (existing && existing.squadComplete) {
        // finalist already carrying a parsed squad — enrich only
        existing.category = entry.category;
        existing.tags = JSON.stringify(entry.tags);
        curatedEnriched++;
        continue;
      }

      // needs a squad from its club-season article (or stays category-only)
      let squadAttached = false;
      if (entry.squadPage) {
        const raw = loadRaw("wikipedia-club-season-pages", entry.squadPage);
        if (!raw) {
          flag({ entityType: "club_season", entityId: csId, flagType: "missing-squad-page", severity: "warn", detail: `raw payload for "${entry.squadPage}" not ingested` });
        } else {
          const recordId = `wikipedia-club-season-pages:${slugify(raw.recordKey)}`;
          const parsed = parseSquadPage(raw.payload);
          for (const a of parsed.anomalies) {
            flag({ entityType: "club_season", entityId: csId, flagType: "parse-anomaly", severity: "warn", detail: `${entry.squadPage}: ${a}` });
          }
          const hasGk = parsed.players.some((p) => p.pos === "GK");
          if (parsed.players.length >= 11 && hasGk) {
            // squad-list evidence; per-player European stats raise confidence
            const csConfidence = parsed.hasSeasonStats ? 0.78 : 0.7;
            for (const sp of parsed.players) {
              const rp = resolvePlayer(sp.linkTarget, sp.displayName);
              if (!playerRows.has(rp.playerId)) {
                playerRows.set(rp.playerId, {
                  id: rp.playerId,
                  name: rp.displayName,
                  nationality: sp.nationality,
                  identityEvidence: rp.identityEvidence,
                  wikiTitle: sp.linkTarget,
                });
                if (rp.identityEvidence === "name-only") {
                  flag({ entityType: "player", entityId: rp.playerId, flagType: "name-only-identity", severity: "warn", detail: `no wikilink for "${rp.displayName}" — duplicate risk` });
                }
              }
              const psId = `ps-${rp.playerId.slice(2)}-${norm.endYear}`;
              const psKey = `${rp.playerId}@${csId}`;
              if (playerSeasonIndex.has(psKey)) continue;
              if (playerSeasonRows.some((r) => r.id === psId)) {
                flag({ entityType: "player_season", entityId: psId, flagType: "duplicate-candidate", severity: "info", detail: `${rp.displayName} already has a player-season this season (mid-season transfer or shared identity); kept first` });
                continue;
              }
              playerSeasonIndex.set(psKey, psId);
              const psConf = rp.identityEvidence === "name-only" ? csConfidence * 0.8 : csConfidence;
              const posRes = posToGroup(sp.pos);
              playerSeasonRows.push({
                id: psId,
                playerId: rp.playerId,
                clubSeasonId: csId,
                pos: sp.pos,
                positions: JSON.stringify(sp.positions.length ? sp.positions : [sp.pos]),
                posGroup: posRes.group,
                posInferred: !posRes.confident,
                shirt: sp.shirt,
                nationality: sp.nationality,
                captain: false,
                role: "squad",
                finalGoals: 0,
                continentalApps: sp.continentalApps,
                continentalGoals: sp.continentalGoals,
                continentalStarts: sp.continentalStarts,
                leagueApps: sp.leagueApps,
                leagueGoals: sp.leagueGoals,
                confidenceScore: Math.round(psConf * 100) / 100,
                confidenceLabel: psConf >= 0.8 ? "high" : psConf >= 0.65 ? "medium" : "low",
                needsReview: sp.continentalApps === null,
                reviewReason:
                  sp.continentalApps === null ? "squad-list evidence only (no per-player season stats)" : null,
                sourceRecordId: recordId,
              });
              squadRows.push({ clubSeasonId: csId, playerSeasonId: psId });
            }
            squadAttached = true;
            curatedSquads++;
            const progression = PROGRESSION_BY_CATEGORY[entry.category] ?? "PART";
            if (existing) {
              existing.progression = progression;
              existing.category = entry.category;
              existing.tags = JSON.stringify(entry.tags);
              existing.squadComplete = true;
              existing.starterCount = 0;
              existing.playerCount = parsed.players.length;
              existing.hasGoalkeeper = true;
              existing.confidenceScore = csConfidence;
              existing.confidenceLabel = "medium";
              existing.needsReview = true;
              existing.reviewReason = "squad-list evidence only";
              existing.sourceRecordId = recordId;
            } else {
              clubSeasonRows.push({
                id: csId,
                clubId: club.clubId,
                seasonId: norm.seasonId,
                progression,
                category: entry.category,
                tags: JSON.stringify(entry.tags),
                finalScore: null,
                squadComplete: true,
                starterCount: 0,
                playerCount: parsed.players.length,
                hasGoalkeeper: true,
                confidenceScore: csConfidence,
                confidenceLabel: "medium",
                needsReview: true,
                reviewReason: "squad-list evidence only",
                sourceRecordId: recordId,
              });
              clubSeasonIds.add(csId);
            }
          }
        }
      }
      if (!squadAttached) {
        // category-only enrichment (no usable squad — stays non-draftable)
        if (existing) {
          existing.category = entry.category;
          existing.tags = JSON.stringify(entry.tags);
          curatedEnriched++;
        } else {
          clubSeasonRows.push({
            id: csId,
            clubId: club.clubId,
            seasonId: norm.seasonId,
            progression: PROGRESSION_BY_CATEGORY[entry.category] ?? "PART",
            category: entry.category,
            tags: JSON.stringify(entry.tags),
            finalScore: null,
            squadComplete: false,
            starterCount: 0,
            playerCount: 0,
            hasGoalkeeper: false,
            confidenceScore: 0.5,
            confidenceLabel: "low",
            needsReview: true,
            reviewReason: "curated iconic team without squad evidence",
            sourceRecordId: null,
          });
          clubSeasonIds.add(csId);
          curatedEnriched++;
        }
      }
    }
  }

  // ---------- factual category for every club-season ----------
  // Curated categories stand; everything else derives from evidence:
  // finalists from the finals list, others from round reached in match data.
  const roundOrdinalByName = (name: string): number => {
    const n = name.toLowerCase();
    if (n.includes("final") && !n.includes("semi") && !n.includes("quarter")) return 6;
    if (n.includes("semi")) return 5;
    if (n.includes("quarter")) return 4;
    if (n.includes("16") || n.includes("second round") || n.includes("eighth")) return 3;
    if (n.includes("group") || n.includes("league")) return 2;
    return 1;
  };
  const roundNameById = new Map(roundRows.map((r) => [r.id, r.name]));
  const bestRoundByCs = new Map<string, number>();
  for (const m of matchRows) {
    const score = roundOrdinalByName(roundNameById.get(m.roundId) ?? "");
    for (const csId of [m.homeClubSeasonId, m.awayClubSeasonId]) {
      bestRoundByCs.set(csId, Math.max(bestRoundByCs.get(csId) ?? 0, score));
    }
  }
  for (const cs of clubSeasonRows) {
    if (cs.category && cs.category !== "participant") continue; // curated
    if (cs.progression === "W") cs.category = "champion";
    else if (cs.progression === "RU") cs.category = "runner_up";
    else {
      const best = bestRoundByCs.get(cs.id!) ?? 0;
      cs.category =
        best >= 5 ? "semi_finalist" : best === 4 ? "quarter_finalist" : best === 3 ? "round_of_16" : best === 2 ? "group_stage" : "participant";
    }
  }

  // ---------- impossible-squad / sanity checks ----------
  for (const cs of clubSeasonRows) {
    if (cs.playerCount! > 0 && cs.playerCount! < 11) {
      flag({ entityType: "club_season", entityId: cs.id!, flagType: "squad-too-small", severity: "warn", detail: `${cs.playerCount} players` });
    }
    if (cs.playerCount! > 30) {
      flag({ entityType: "club_season", entityId: cs.id!, flagType: "impossible-squad", severity: "error", detail: `${cs.playerCount} players parsed — suspicious` });
    }
  }

  // duplicate-name candidates across players (same display name, different ids)
  const byName = new Map<string, string[]>();
  for (const p of playerRows.values()) {
    const key = slugify(p.name);
    byName.set(key, [...(byName.get(key) ?? []), p.id]);
  }
  for (const [name, ids] of byName) {
    if (ids.length > 1) {
      flag({
        entityType: "player", entityId: ids.join(","), flagType: "duplicate-candidate",
        severity: "info", detail: `display name "${name}" maps to ${ids.length} distinct identities (kept separate: wikilink evidence)`,
      });
    }
  }

  // ---------- positions reference ----------
  const posCodes = new Set(playerSeasonRows.map((r) => r.pos!));
  const posRefRows = [...posCodes].map((code) => {
    const g = posToGroup(code);
    return { code, groupCode: g.group, label: code };
  });

  // ---------- manual overrides (registered here, applied at ratings time) ----------
  const overridesPath = path.join(process.cwd(), "data", "overrides", "ratings.json");
  let overrideCount = 0;
  if (fs.existsSync(overridesPath)) {
    const overrides = JSON.parse(fs.readFileSync(overridesPath, "utf8")) as Array<{
      playerSeasonId: string;
      fields: Record<string, number>;
      reason: string;
      authorNote: string;
      date: string;
    }>;
    for (const o of overrides) {
      db.insert(t.manualOverrides)
        .values({
          entityType: "player_season_rating",
          entityId: o.playerSeasonId,
          fieldsChanged: JSON.stringify(o.fields),
          reason: o.reason,
          authorNote: o.authorNote,
          date: o.date,
        })
        .run();
      overrideCount++;
      if (!psIds.has(o.playerSeasonId)) {
        flag({
          entityType: "manual_override", entityId: o.playerSeasonId, flagType: "override-target-missing",
          severity: "warn", detail: "override references a player-season that does not exist",
        });
      }
    }
  }

  // ---------- write everything ----------
  const insertMany = <T,>(table: Parameters<typeof db.insert>[0], rows: T[]) => {
    const chunk = 200;
    for (let i = 0; i < rows.length; i += chunk) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      db.insert(table).values(rows.slice(i, i + chunk) as any).run();
    }
  };

  insertMany(t.seasons, seasonRows);
  insertMany(t.rounds, roundRows);
  insertMany(t.clubs, [...clubRows.values()]);
  insertMany(t.clubAliases, clubAliasRows);
  insertMany(t.clubSeasons, clubSeasonRows);
  insertMany(t.players, [...playerRows.values()]);
  if (playerAliasRows.length) insertMany(t.playerAliases, playerAliasRows);
  insertMany(t.playerSeasons, playerSeasonRows);
  insertMany(t.squads, squadRows);
  insertMany(t.matches, matchRows);
  insertMany(t.appearances, appearanceRows);
  insertMany(t.goals, goalRows.map((g) => ({ ...g })));
  insertMany(t.positionsRef, posRefRows);
  insertMany(
    t.dataQualityFlags,
    flags.map((f) => ({ ...f, createdAt: now() })),
  );

  console.log(`CLEAN complete (parser ${PARSER_VERSION})`);
  console.log(`  seasons:        ${seasonRows.length}`);
  console.log(`  clubs:          ${clubRows.size}`);
  console.log(`  club-seasons:   ${clubSeasonRows.length} (${clubSeasonRows.filter((c) => c.squadComplete).length} squad-complete)`);
  console.log(`  players:        ${playerRows.size}`);
  console.log(`  player-seasons: ${playerSeasonRows.length}`);
  console.log(`  matches:        ${matchRows.length}`);
  console.log(`  goals:          ${goalRows.length}`);
  console.log(`  quality flags:  ${flags.length}`);
  console.log(`  overrides:      ${overrideCount}`);
  console.log(`  curated squads: ${curatedSquads} ingested, ${curatedEnriched} category-enriched`);
  sqlite.close();
}

function pushBlock(map: Map<string, LineupBlock[]>, clubId: string, block: LineupBlock) {
  const list = map.get(clubId) ?? [];
  list.push(block);
  map.set(clubId, list);
}

interface MergedPlayer {
  playerId: string;
  displayName: string;
  identityEvidence: "wikilink" | "name-only";
  linkTarget: string | null;
  pos: string;
  shirt: number | null;
  nationality: string | null;
  captain: boolean;
  isStarter: boolean;
  cameOn: boolean;
}

function mergePlayer(
  existing: MergedPlayer | undefined,
  lp: { pos: string; shirt: number | null; nationality: string | null; linkTarget: string | null; captain: boolean; isStarter: boolean; subOnMinute: number | null },
  rp: { playerId: string; displayName: string; identityEvidence: "wikilink" | "name-only" },
): MergedPlayer {
  if (!existing) {
    return {
      playerId: rp.playerId,
      displayName: rp.displayName,
      identityEvidence: rp.identityEvidence,
      linkTarget: lp.linkTarget,
      pos: lp.pos,
      shirt: lp.shirt,
      nationality: lp.nationality,
      captain: lp.captain,
      isStarter: lp.isStarter,
      cameOn: lp.subOnMinute !== null,
    };
  }
  return {
    ...existing,
    captain: existing.captain || lp.captain,
    isStarter: existing.isStarter || lp.isStarter,
    cameOn: existing.cameOn || lp.subOnMinute !== null,
    pos: existing.isStarter ? existing.pos : lp.pos,
  };
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
