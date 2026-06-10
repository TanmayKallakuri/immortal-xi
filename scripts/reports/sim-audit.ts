/**
 * SIMULATION AUDIT:  npm run sim-audit
 *
 * Simulates full campaigns across many deterministic seeds and three XI
 * cohorts (drafted / monster / average) and verifies the opponent power
 * scale is structurally sound. Writes data/reports/sim-audit.json and exits
 * 1 on any violation.
 *
 * Checks:
 *  - escalation: average opponent strength rises league -> playoff -> R16 ->
 *    QF -> SF -> final, with the final the hardest on average
 *  - stage bands: knockout opponents stay within their stage's band
 *    (tolerance for relaxed draws when pools starve)
 *  - exclusions: no opponent club-season is ever one the user drafted from
 *  - club variety: no club faced twice within one campaign
 *  - late-round variety: across seeds the final is not the same opponent
 *  - no hidden nerf: a monster XI still wins titles; an average XI exits
 *    earlier on average
 */
import fs from "node:fs";
import path from "node:path";
import { loadGameData, type GameDataIndex } from "../../lib/data/game-data";
import { simulateCampaign, STAGE_BANDS, type CampaignResult, type KnockoutTie } from "../../lib/simulation/campaign";
import { SIM_VERSION } from "../../lib/simulation/version";
import { newDraft, spin, applyPick, type DraftState } from "../../lib/draft/engine";
import { formationById, slotFitForPositions } from "../../lib/draft/formations";
import type { SeedPayload } from "../../lib/draft/seed";
import type { GamePlayerSeason } from "../../lib/types";

const FORMATION = "433";

/** deterministic auto-draft: always pick the best-rated selectable player */
function autoDraft(index: GameDataIndex, seed: string): SeedPayload {
  let state: DraftState = newDraft(seed, FORMATION, "classic");
  while (state.round < 11) {
    const s = spin(state, index);
    const selectable = s.selectable
      .filter((p) => !p.blockedReason)
      .sort((a, b) => b.player.ratings.overall - a.player.ratings.overall || a.player.id.localeCompare(b.player.id));
    const open = selectable.find((p) => p.eligibleSlots.some((e) => e.slot.group === p.player.posGroup)) ?? selectable[0];
    const slot = open.eligibleSlots.slice().sort((a, b) => b.fit - a.fit || a.slot.id.localeCompare(b.slot.id))[0].slot;
    state = applyPick(state, s.clubSeason, open.player.id, slot.id, index);
  }
  const formation = formationById(FORMATION)!;
  const bySlot = new Map(state.picks.map((p) => [p.slotId, p.playerSeasonId]));
  return {
    dataVersion: index.data.dataVersion,
    simVersion: SIM_VERSION,
    mode: "classic",
    formationId: FORMATION,
    draftSeed: seed,
    playerSeasonIds: formation.slots.map((sl) => bySlot.get(sl.id)!),
  };
}

/** slot-by-slot XI built by a scoring function (no draft randomness) */
function buildXi(index: GameDataIndex, score: (p: GamePlayerSeason) => number, seedName: string): SeedPayload {
  const formation = formationById(FORMATION)!;
  const usedPlayers = new Set<string>();
  const usedClubSeasons = new Set<string>();
  const picks: string[] = [];
  for (const slot of formation.slots) {
    const candidates = index.data.playerSeasons
      .filter(
        (p) =>
          !usedPlayers.has(p.playerId) &&
          !usedClubSeasons.has(p.clubSeasonId) &&
          slotFitForPositions(p.positions, p.posGroup, slot) > 0,
      )
      .sort((a, b) => score(b) - score(a) || a.id.localeCompare(b.id));
    const pick = candidates[0];
    if (!pick) throw new Error(`no candidate for slot ${slot.id}`);
    usedPlayers.add(pick.playerId);
    usedClubSeasons.add(pick.clubSeasonId);
    picks.push(pick.id);
  }
  return {
    dataVersion: index.data.dataVersion,
    simVersion: SIM_VERSION,
    mode: "classic",
    formationId: FORMATION,
    draftSeed: seedName,
    playerSeasonIds: picks,
  };
}

interface StageSample {
  stage: string;
  strength: number;
}

function collectCampaign(
  index: GameDataIndex,
  payload: SeedPayload,
  violations: string[],
  samples: StageSample[],
): CampaignResult {
  const players = payload.playerSeasonIds.map((id) => index.playerSeasonById.get(id)!);
  const c = simulateCampaign(payload, players, index);
  const draftedCs = new Set(players.map((p) => p.clubSeasonId));

  for (const m of c.leagueMatches) {
    samples.push({ stage: "league", strength: m.opponentStrength });
    if (draftedCs.has(m.opponentClubSeasonId)) {
      violations.push(`drafted club-season ${m.opponentClubSeasonId} appeared as league opponent (seed ${payload.draftSeed})`);
    }
  }
  const facedClubs = new Map<string, number>();
  for (const m of c.leagueMatches) {
    const clubId = index.clubSeasonById.get(m.opponentClubSeasonId)?.clubId ?? m.opponentClubSeasonId;
    facedClubs.set(clubId, (facedClubs.get(clubId) ?? 0) + 1);
  }
  for (const tie of c.knockout) {
    samples.push({ stage: tie.round, strength: tie.opponentStrength });
    if (draftedCs.has(tie.opponentClubSeasonId)) {
      violations.push(`drafted club-season ${tie.opponentClubSeasonId} appeared as ${tie.round} opponent (seed ${payload.draftSeed})`);
    }
    const clubId = index.clubSeasonById.get(tie.opponentClubSeasonId)?.clubId ?? tie.opponentClubSeasonId;
    facedClubs.set(clubId, (facedClubs.get(clubId) ?? 0) + 1);
    const band = STAGE_BANDS[tie.round as KnockoutTie["round"]];
    if (tie.opponentStrength < band.min - 6 || tie.opponentStrength > band.max + 2) {
      violations.push(
        `${tie.round} opponent ${tie.opponentName} strength ${tie.opponentStrength} far outside band [${band.min}, ${band.max}] (seed ${payload.draftSeed})`,
      );
    }
  }
  for (const [clubId, n] of facedClubs) {
    if (n > 1) violations.push(`club ${clubId} faced ${n} times in one campaign (seed ${payload.draftSeed})`);
  }
  return c;
}

const CHAMPION_OUTCOMES = new Set(["champion", "unbeaten-champion", "perfect-champion"]);

async function main() {
  const index = await loadGameData();
  const violations: string[] = [];
  const samples: StageSample[] = [];

  // cohort 1: realistic drafted XIs across seeds
  const draftedOutcomes: string[] = [];
  const finalOpponents = new Set<string>();
  for (let i = 0; i < 24; i++) {
    const payload = autoDraft(index, `sim-audit-${i}`);
    const c = collectCampaign(index, payload, violations, samples);
    draftedOutcomes.push(c.outcome);
    const final = c.knockout.find((t) => t.round === "final");
    if (final) finalOpponents.add(final.opponentClubSeasonId);
  }

  // cohort 2: monster XI (best player available per slot)
  const monsterPayload = buildXi(index, (p) => p.ratings.overall, "monster-xi");
  const monsterOutcomes: string[] = [];
  for (let i = 0; i < 30; i++) {
    const c = collectCampaign(index, { ...monsterPayload, draftSeed: `monster-${i}` }, violations, samples);
    monsterOutcomes.push(c.outcome);
  }

  // cohort 3: average XI (ordinary squad players, ~median overall)
  const averagePayload = buildXi(index, (p) => -Math.abs(p.ratings.overall - 78), "average-xi");
  const averageOutcomes: string[] = [];
  for (let i = 0; i < 30; i++) {
    const c = collectCampaign(index, { ...averagePayload, draftSeed: `average-${i}` }, violations, samples);
    averageOutcomes.push(c.outcome);
  }

  // ---- aggregate strength by stage ----
  const byStage = new Map<string, number[]>();
  for (const s of samples) byStage.set(s.stage, [...(byStage.get(s.stage) ?? []), s.strength]);
  const avgByStage: Record<string, { avg: number; n: number; min: number; max: number }> = {};
  for (const [stage, vals] of byStage) {
    avgByStage[stage] = {
      avg: Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10,
      n: vals.length,
      min: Math.min(...vals),
      max: Math.max(...vals),
    };
  }

  const order = ["league", "playoff", "r16", "qf", "sf", "final"];
  for (let i = 1; i < order.length; i++) {
    const prev = avgByStage[order[i - 1]];
    const cur = avgByStage[order[i]];
    if (!prev || !cur) continue;
    // playoff may dip below the broad league mix's strongest pots, but from
    // R16 on the ladder must escalate strictly on average
    const slack = order[i] === "playoff" ? 3 : 0;
    if (cur.avg + slack < prev.avg) {
      violations.push(`stage ${order[i]} avg strength ${cur.avg} below ${order[i - 1]} (${prev.avg})`);
    }
  }
  const stagesPresent = order.filter((s) => avgByStage[s]);
  const hardest = stagesPresent.sort((a, b) => avgByStage[b].avg - avgByStage[a].avg)[0];
  if (avgByStage.final && hardest !== "final") {
    violations.push(`final is not the hardest stage on average (hardest: ${hardest})`);
  }

  const championRate = (outcomes: string[]) => outcomes.filter((o) => CHAMPION_OUTCOMES.has(o)).length / outcomes.length;
  const monsterRate = championRate(monsterOutcomes);
  const averageRate = championRate(averageOutcomes);
  if (monsterRate === 0) violations.push("monster XI never wins the title across 30 seeds — hidden nerf?");
  if (monsterRate <= averageRate) {
    violations.push(`monster XI title rate (${monsterRate}) not above average XI (${averageRate}) — strength is not respected`);
  }
  if (avgByStage.final && finalOpponents.size < 3 && draftedOutcomes.length >= 10) {
    const finalsReached = draftedOutcomes.filter((o) => o === "runner-up" || CHAMPION_OUTCOMES.has(o)).length;
    if (finalsReached >= 5) violations.push(`only ${finalOpponents.size} distinct final opponents across drafted seeds — variety too low`);
  }

  const dist = (outcomes: string[]) => {
    const d: Record<string, number> = {};
    for (const o of outcomes) d[o] = (d[o] ?? 0) + 1;
    return d;
  };
  const out = {
    generatedAt: new Date().toISOString(),
    simVersion: SIM_VERSION,
    dataVersion: index.data.dataVersion,
    stageBands: STAGE_BANDS,
    avgOpponentStrengthByStage: avgByStage,
    cohorts: {
      drafted: { n: draftedOutcomes.length, outcomes: dist(draftedOutcomes), distinctFinalOpponents: finalOpponents.size },
      monster: { n: monsterOutcomes.length, outcomes: dist(monsterOutcomes), championRate: monsterRate },
      average: { n: averageOutcomes.length, outcomes: dist(averageOutcomes), championRate: averageRate },
    },
    violations,
  };
  const dir = path.join(process.cwd(), "data", "reports");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "sim-audit.json"), JSON.stringify(out, null, 2), "utf8");

  console.log(`SIM AUDIT (sim ${SIM_VERSION})`);
  for (const stage of order) {
    if (avgByStage[stage]) {
      const s = avgByStage[stage];
      console.log(`  ${stage.padEnd(8)} avg ${s.avg}  [${s.min}-${s.max}]  n=${s.n}`);
    }
  }
  console.log(`  monster XI title rate: ${(monsterRate * 100).toFixed(0)}%  |  average XI: ${(averageRate * 100).toFixed(0)}%`);
  console.log(`  distinct final opponents (drafted): ${finalOpponents.size}`);
  if (violations.length) {
    for (const v of violations.slice(0, 20)) console.log(`  [VIOLATION] ${v}`);
  } else {
    console.log("  no violations — opponent power scale structurally sound");
  }
  console.log(`  -> data/reports/sim-audit.json`);
  process.exit(violations.length > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
