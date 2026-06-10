/**
 * Team strength + chemistry from a drafted XI. Pure and deterministic.
 * See docs/SIMULATION.md for the rationale behind every weight.
 */
import type { GameDataIndex } from "../data/game-data";
import type { GamePlayerSeason } from "../types";
import { formationById, slotFitForPositions, type Formation } from "../draft/formations";

export interface XiSlotAssignment {
  slotId: string;
  player: GamePlayerSeason;
}

export interface ChemistryLink {
  kind: "same-club-season" | "same-club-era" | "same-nation" | "same-era" | "mismatch-penalty" | "shape";
  detail: string;
  value: number;
}

export interface TeamProfile {
  attack: number;
  control: number;
  defense: number;
  goalkeeping: number;
  physical: number;
  clutch: number;
  aura: number;
  chemistry: number; // -10 .. +15
  avgFit: number;
  avgConfidence: number; // 0..1 -> drives simulation variance, not quality
  strength: number; // headline blend used for opponents comparisons
  links: ChemistryLink[];
  notes: string[]; // human-readable strengths/weaknesses
}

const ATTACK_W: Record<string, number> = { FW: 1, MF: 0.6, DF: 0.25, GK: 0 };
const CONTROL_W: Record<string, number> = { FW: 0.5, MF: 1, DF: 0.5, GK: 0.2 };
const DEFENSE_W: Record<string, number> = { FW: 0.15, MF: 0.6, DF: 1, GK: 0.5 };

export function computeTeamProfile(
  formation: Formation,
  assignments: XiSlotAssignment[],
  index: GameDataIndex,
): TeamProfile {
  if (assignments.length !== 11) throw new Error("XI must have 11 players");
  const slotById = new Map(formation.slots.map((s) => [s.id, s]));

  let atkNum = 0, atkDen = 0, ctlNum = 0, ctlDen = 0, defNum = 0, defDen = 0;
  let gk = 0, fitSum = 0, physSum = 0, clutchSum = 0, auraSum = 0, confSum = 0;

  for (const a of assignments) {
    const slot = slotById.get(a.slotId);
    if (!slot) throw new Error(`assignment to unknown slot ${a.slotId}`);
    const fit = slotFitForPositions(a.player.positions, a.player.posGroup, slot);
    if (fit <= 0) throw new Error(`invalid XI: ${a.player.name} in ${slot.id}`);
    fitSum += fit;
    const r = a.player.ratings;
    const g = slot.group;
    atkNum += r.attack * fit * ATTACK_W[g];
    atkDen += ATTACK_W[g];
    ctlNum += r.control * fit * CONTROL_W[g];
    ctlDen += CONTROL_W[g];
    defNum += r.defense * fit * DEFENSE_W[g];
    defDen += DEFENSE_W[g];
    if (g === "GK") gk = r.goalkeeping * fit;
    physSum += r.physical;
    clutchSum += r.clutch;
    auraSum += r.uclAura;
    confSum += a.player.confidence.score;
  }

  const links: ChemistryLink[] = [];
  let chem = 0;
  const players = assignments.map((a) => a.player);

  // same club-season pairs
  const byClubSeason = new Map<string, GamePlayerSeason[]>();
  for (const p of players) {
    byClubSeason.set(p.clubSeasonId, [...(byClubSeason.get(p.clubSeasonId) ?? []), p]);
  }
  for (const [csId, group] of byClubSeason) {
    if (group.length >= 2) {
      const cs = index.clubSeasonById.get(csId);
      const v = Math.min(6, (group.length - 1) * 2);
      chem += v;
      links.push({
        kind: "same-club-season",
        detail: `${group.length} from ${cs?.clubName ?? csId} ${cs?.season ?? ""}`,
        value: v,
      });
    }
  }
  // same club, different era
  const byClub = new Map<string, Set<string>>();
  for (const p of players) {
    const cs = index.clubSeasonById.get(p.clubSeasonId);
    if (!cs) continue;
    byClub.set(cs.clubId, (byClub.get(cs.clubId) ?? new Set()).add(cs.id));
  }
  for (const [clubId, seasons] of byClub) {
    if (seasons.size >= 2) {
      chem += 0.5;
      links.push({ kind: "same-club-era", detail: `${clubId} across eras`, value: 0.5 });
    }
  }
  // shared nationality
  const byNation = new Map<string, number>();
  for (const p of players) {
    if (p.nationality) byNation.set(p.nationality, (byNation.get(p.nationality) ?? 0) + 1);
  }
  let natChem = 0;
  for (const [nat, n] of byNation) {
    if (n >= 2) {
      natChem += (n - 1) * 0.5;
      links.push({ kind: "same-nation", detail: `${n} × ${nat}`, value: (n - 1) * 0.5 });
    }
  }
  chem += Math.min(3, natChem);
  // shared era
  const byEra = new Map<string, number>();
  for (const p of players) {
    const era = index.clubSeasonById.get(p.clubSeasonId)?.eraLabel ?? "?";
    byEra.set(era, (byEra.get(era) ?? 0) + 1);
  }
  let eraChem = 0;
  for (const [era, n] of byEra) {
    if (n >= 3) {
      eraChem += (n - 2) * 0.4;
      links.push({ kind: "same-era", detail: `${n} from the ${era}`, value: (n - 2) * 0.4 });
    }
  }
  chem += Math.min(3, eraChem);
  // severe position mismatches
  for (const a of assignments) {
    const slot = slotById.get(a.slotId)!;
    const fit = slotFitForPositions(a.player.positions, a.player.posGroup, slot);
    if (fit > 0 && fit <= 0.8) {
      chem -= 3;
      links.push({
        kind: "mismatch-penalty",
        detail: `${a.player.name} (${a.player.pos}) at ${slot.label}`,
        value: -3,
      });
    }
  }
  const avgFit = fitSum / 11;
  if (avgFit >= 0.96) {
    chem += 2;
    links.push({ kind: "shape", detail: "balanced formation", value: 2 });
  }
  chem = Math.max(-10, Math.min(15, chem));

  const attack = atkNum / atkDen;
  const control = ctlNum / ctlDen;
  const defense = defNum / defDen;
  const physical = physSum / 11;
  const clutch = clutchSum / 11;
  const aura = auraSum / 11;
  const avgConfidence = confSum / 11;

  const strength =
    attack * 0.28 + control * 0.22 + defense * 0.27 + gk * 0.13 + physical * 0.04 + aura * 0.06 + chem * 0.8;

  const notes: string[] = [];
  if (attack >= 88) notes.push("Galáctico-grade front line");
  if (defense >= 88) notes.push("A defensive wall across eras");
  if (control >= 88) notes.push("Total control of midfield");
  if (gk >= 90) notes.push("World-class last line");
  if (gk < 78) notes.push("Goalkeeping is a gamble");
  if (chem >= 8) notes.push("Strong dressing-room chemistry");
  if (chem < 0) notes.push("Chemistry concerns: square pegs in round holes");
  if (avgConfidence < 0.75) notes.push("Several deep-archive picks: results may swing");
  if (aura >= 85) notes.push("Champions League aura: this team expects to win");

  return {
    attack, control, defense, goalkeeping: gk, physical, clutch, aura,
    chemistry: chem, avgFit, avgConfidence, strength, links, notes,
  };
}

export function profileFromSeedPlayers(
  formationId: string,
  players: GamePlayerSeason[],
  index: GameDataIndex,
): { formation: Formation; assignments: XiSlotAssignment[]; profile: TeamProfile } {
  const formation = formationById(formationId);
  if (!formation) throw new Error(`unknown formation ${formationId}`);
  const assignments = formation.slots.map((slot, i) => ({ slotId: slot.id, player: players[i] }));
  return { formation, assignments, profile: computeTeamProfile(formation, assignments, index) };
}
