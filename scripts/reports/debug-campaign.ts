/** Dev tool: simulate one campaign for a constructed XI and dump internals. */
import { loadGameData, type GameDataIndex } from "../../lib/data/game-data";
import { simulateCampaign } from "../../lib/simulation/campaign";
import { SIM_VERSION } from "../../lib/simulation/version";
import { formationById, slotFitForPositions } from "../../lib/draft/formations";
import type { SeedPayload } from "../../lib/draft/seed";
import type { GamePlayerSeason } from "../../lib/types";

function buildXi(index: GameDataIndex, score: (p: GamePlayerSeason) => number, seedName: string): SeedPayload {
  const formation = formationById("433")!;
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
    formationId: "433",
    draftSeed: seedName,
    playerSeasonIds: picks,
  };
}

async function main() {
  const index = await loadGameData();
  const payload = buildXi(index, (p) => p.ratings.overall, "monster-0");
  const players = payload.playerSeasonIds.map((id) => index.playerSeasonById.get(id)!);
  console.log("XI:", players.map((p) => `${p.name} ${p.ratings.overall}`).join(" | "));
  const c = simulateCampaign(payload, players, index);
  console.log("profile:", JSON.stringify({
    attack: c.profile.attack.toFixed(1), control: c.profile.control.toFixed(1),
    defense: c.profile.defense.toFixed(1), gk: c.profile.goalkeeping.toFixed(1),
    chem: c.profile.chemistry, aura: c.profile.aura.toFixed(1), strength: c.profile.strength.toFixed(1),
  }));
  console.log("league:", JSON.stringify(c.leagueRecord));
  for (const m of c.leagueMatches) {
    console.log(`  ${m.label} vs ${m.opponentName} (str ${m.opponentStrength}): ${m.userGoals}-${m.oppGoals}`);
  }
  console.log("outcome:", c.outcome);
  for (const t of c.knockout) console.log(`  ${t.round} vs ${t.opponentName} (str ${t.opponentStrength}) agg ${t.aggregate} won=${t.won}`);
  console.log("table top/bottom:", c.table.slice(0, 3).map((r) => `${r.name} ${r.points}`), "...", c.table.slice(-3).map((r) => `${r.name} ${r.points}`));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
