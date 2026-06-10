/**
 * Head-to-head: two reconstructed seeds battle deterministically.
 * Same seeds + same mode + same SIM_VERSION => identical result, always.
 */
import { createRng } from "../rng";
import type { GameDataIndex } from "../data/game-data";
import type { GamePlayerSeason } from "../types";
import { SIM_VERSION } from "./version";
import { profileFromSeedPlayers, type TeamProfile } from "./strength";
import { simulateMatch, simulateExtraTime, type MatchResult, type SideInput } from "./engine";
import type { SeedPayload } from "../draft/seed";

export type BattleMode = "final" | "two-legged" | "best-of-7";

export const BATTLE_MODE_LABEL: Record<BattleMode, string> = {
  final: "One-off neutral final",
  "two-legged": "Two-legged knockout tie",
  "best-of-7": "Best-of-7 fantasy series",
};

export interface H2hSide {
  label: string;
  payload: SeedPayload;
  players: GamePlayerSeason[];
  profile: TeamProfile;
}

export interface H2hLeg {
  label: string;
  result: MatchResult;
  /** goals from side A's perspective */
  aGoals: number;
  bGoals: number;
}

export interface TacticalNote {
  category: string;
  aValue: number;
  bValue: number;
  text: string;
}

export interface H2hResult {
  simVersion: string;
  mode: BattleMode;
  legs: H2hLeg[];
  aggregate: [number, number]; // goals (final/tie) or series wins (best-of-7)
  pens: [number, number] | null;
  winner: 0 | 1;
  tacticalNotes: TacticalNote[];
  battleId: string; // shareable identifier of this exact battle
}

function sideInput(label: string, side: H2hSide): SideInput {
  const p = side.profile;
  return {
    name: label,
    attack: p.attack,
    control: p.control,
    defense: p.defense,
    goalkeeping: p.goalkeeping,
    clutch: p.clutch,
    aura: p.aura,
    chemistry: p.chemistry,
    confidence: p.avgConfidence,
    scorers: side.players,
    keeperName: side.players.find((pl) => pl.posGroup === "GK")?.name,
  };
}

export function buildSide(label: string, payload: SeedPayload, players: GamePlayerSeason[], index: GameDataIndex): H2hSide {
  const { profile } = profileFromSeedPlayers(payload.formationId, players, index);
  return { label, payload, players, profile };
}

function tacticalNotes(a: H2hSide, b: H2hSide): TacticalNote[] {
  const rows: Array<[string, number, number, (d: number) => string]> = [
    ["Attack", a.profile.attack, b.profile.attack, (d) => d > 0 ? `${a.label} carry the sharper blade up front` : `${b.label} bring the heavier artillery`],
    ["Midfield control", a.profile.control, b.profile.control, (d) => d > 0 ? `${a.label} should own the tempo` : `${b.label} should own the tempo`],
    ["Defense", a.profile.defense, b.profile.defense, (d) => d > 0 ? `${a.label}'s rearguard is harder to break` : `${b.label}'s rearguard is harder to break`],
    ["Goalkeeping", a.profile.goalkeeping, b.profile.goalkeeping, (d) => d > 0 ? `Edge between the posts: ${a.label}` : `Edge between the posts: ${b.label}`],
    ["Big-game clutch", a.profile.clutch, b.profile.clutch, (d) => d > 0 ? `${a.label} live for the late minutes` : `${b.label} live for the late minutes`],
    ["European aura", a.profile.aura, b.profile.aura, (d) => d > 0 ? `History walks with ${a.label}` : `History walks with ${b.label}`],
    ["Chemistry", a.profile.chemistry, b.profile.chemistry, (d) => d > 0 ? `${a.label} feel like a real team` : `${b.label} feel like a real team`],
  ];
  return rows.map(([category, av, bv, t]) => ({
    category,
    aValue: Math.round(av * 10) / 10,
    bValue: Math.round(bv * 10) / 10,
    text: Math.abs(av - bv) < 1 ? `${category}: dead even` : t(av - bv),
  }));
}

export function simulateH2h(a: H2hSide, b: H2hSide, mode: BattleMode): H2hResult {
  const battleKey = ["h2h", SIM_VERSION, mode, a.payload.draftSeed, a.payload.playerSeasonIds.join(","), b.payload.draftSeed, b.payload.playerSeasonIds.join(",")].join("|");
  const rootRng = createRng(battleKey);
  const A = sideInput(a.label, a);
  const B = sideInput(b.label, b);
  const legs: H2hLeg[] = [];
  let aggregate: [number, number] = [0, 0];
  let pens: [number, number] | null = null;
  let winner: 0 | 1 = 0;

  if (mode === "final") {
    const res = simulateMatch(rootRng.fork("final"), A, B, { homeBoost: 1, mustDecide: true });
    legs.push({ label: "Final (neutral venue)", result: res, aGoals: res.goals[0], bGoals: res.goals[1] });
    aggregate = res.goals;
    pens = res.pens;
    winner = res.winner === 1 ? 1 : 0;
  } else if (mode === "two-legged") {
    const leg1 = simulateMatch(rootRng.fork("leg1"), A, B, { homeBoost: 1.12 });
    legs.push({ label: "1st leg (A at home)", result: leg1, aGoals: leg1.goals[0], bGoals: leg1.goals[1] });
    const leg2 = simulateMatch(rootRng.fork("leg2"), B, A, { homeBoost: 1.12 });
    let aggA = leg1.goals[0] + leg2.goals[1];
    let aggB = leg1.goals[1] + leg2.goals[0];
    let leg2final = leg2;
    if (aggA === aggB) {
      // ET-only decider (no regulation re-sim); side order [B(home), A]
      const decider = simulateExtraTime(rootRng.fork("leg2-et"), B, A, 1.06);
      const [etB, etA] = decider.etGoals;
      aggA += etA;
      aggB += etB;
      leg2final = {
        ...leg2,
        goals: [leg2.goals[0] + etB, leg2.goals[1] + etA],
        etGoals: [etB, etA],
        events: [...leg2.events, ...decider.events],
      };
      if (aggA === aggB) {
        if (!decider.pens) throw new Error("unreachable: level aggregate after ET without penalties");
        pens = [decider.pens[1], decider.pens[0]]; // normalize [B, A] -> [A, B]
      }
    }
    legs[1] = { label: "2nd leg (B at home)", result: leg2final, aGoals: leg2final.goals[1], bGoals: leg2final.goals[0] };
    aggregate = [aggA, aggB];
    if (aggA === aggB && !pens) throw new Error("unreachable: tied two-legged battle without penalties");
    winner = aggA > aggB ? 0 : aggB > aggA ? 1 : pens![0] > pens![1] ? 0 : 1;
  } else {
    let winsA = 0;
    let winsB = 0;
    let game = 0;
    while (winsA < 4 && winsB < 4) {
      game++;
      const res = simulateMatch(rootRng.fork(`game-${game}`), A, B, { homeBoost: 1, mustDecide: true });
      legs.push({ label: `Game ${game}`, result: res, aGoals: res.goals[0], bGoals: res.goals[1] });
      if (res.winner === 0) winsA++;
      else winsB++;
    }
    aggregate = [winsA, winsB];
    winner = winsA > winsB ? 0 : 1;
  }

  return {
    simVersion: SIM_VERSION,
    mode,
    legs,
    aggregate,
    pens,
    winner,
    tacticalNotes: tacticalNotes(a, b),
    battleId: "B" + Math.abs(hashOf(battleKey)).toString(36),
  };
}

function hashOf(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  return h;
}
