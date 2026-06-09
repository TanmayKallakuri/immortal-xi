/** Badge detection over a completed campaign + the drafted XI. */
import type { GameDataIndex } from "../data/game-data";
import type { GamePlayerSeason } from "../types";
import type { CampaignResult } from "./campaign";

export interface Badge {
  id: string;
  name: string;
  description: string;
  tier: "gold" | "silver" | "bronze";
}

export function detectBadges(
  result: CampaignResult,
  players: GamePlayerSeason[],
  index: GameDataIndex,
): Badge[] {
  const badges: Badge[] = [];
  const add = (id: string, name: string, description: string, tier: Badge["tier"]) =>
    badges.push({ id, name, description, tier });

  const champion = ["champion", "unbeaten-champion", "perfect-champion"].includes(result.outcome);

  if (result.outcome === "perfect-champion")
    add("perfect", "European Royalty", "Won every single match of the campaign.", "gold");
  else if (result.outcome === "unbeaten-champion")
    add("unbeaten", "The Invincible Crown", "Champions without losing a match.", "gold");
  else if (champion) add("champion", "Champions of Europe", "Lifted the trophy.", "gold");
  if (result.outcome === "runner-up")
    add("heartbreak", "Final Heartbreak", "So close. The silver medal nobody wants.", "silver");

  const koWins = result.knockout.filter((t) => t.won).length;
  if (koWins >= 4) add("ko-specialist", "Knockout Specialist", `Won ${koWins} knockout ties.`, "silver");

  const pensSurvived = result.knockout.filter((t) => t.won && t.pens).length;
  if (pensSurvived >= 1) add("nerves", "Twelve-Yard Nerves", "Survived a penalty shootout.", "bronze");

  if (result.leagueRecord.ga <= 4 && result.leagueRecord.l === 0)
    add("wall", "Defensive Wall", `Only ${result.leagueRecord.ga} conceded in the league phase.`, "silver");
  if (result.leagueRecord.gf >= 20)
    add("attack", "All-Out Attack", `${result.leagueRecord.gf} league-phase goals.`, "silver");
  if (result.profile.control >= 88)
    add("midfield", "Midfield Dynasty", "Total control of every midfield battle.", "bronze");
  if (result.profile.attack >= 90) add("galactico", "Galáctico Attack", "A front line from the gods.", "bronze");

  // draft-composition badges
  const eras = new Set(players.map((p) => index.clubSeasonById.get(p.clubSeasonId)?.eraLabel));
  if (eras.size >= 5) add("cross-era", "Era Blender", `Players from ${eras.size} different decades.`, "silver");

  const clubSeasonsOf = new Map<string, Set<string>>();
  for (const p of players) {
    const cs = index.clubSeasonById.get(p.clubSeasonId);
    if (!cs) continue;
    clubSeasonsOf.set(cs.clubId, (clubSeasonsOf.get(cs.clubId) ?? new Set()).add(cs.id));
  }
  for (const [, seasons] of clubSeasonsOf) {
    if (seasons.size >= 2) {
      add("era-collision", "Same-Club Era Collision", "Two eras of the same club share one dressing room.", "gold");
      break;
    }
  }
  const byClubSeason = new Map<string, number>();
  for (const p of players) byClubSeason.set(p.clubSeasonId, (byClubSeason.get(p.clubSeasonId) ?? 0) + 1);
  if (Math.max(...byClubSeason.values()) >= 4)
    add("loyalty", "Club Loyalty Run", "Four or more players from one club-season.", "bronze");

  const underdogs = players.filter((p) => {
    const cs = index.clubSeasonById.get(p.clubSeasonId);
    return cs && (index.finalistSeasonsByClub.get(cs.clubId) ?? 0) <= 2;
  });
  if (underdogs.length >= 4)
    add("underdog", "Underdog Collector", `${underdogs.length} picks from cult clubs.`, "silver");
  if (underdogs.length >= 2 && champion)
    add("giantkiller", "Giant-Killer Path", "Won it all with cult-club hearts in the XI.", "gold");

  const lowConf = players.filter((p) => p.confidence.label !== "high");
  if (lowConf.length >= 4 && champion)
    add("chaos", "Data Chaos Survivor", "Champions despite a squad of deep archive picks.", "silver");

  return badges;
}
