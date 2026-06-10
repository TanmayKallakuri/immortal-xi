/**
 * Solo campaign: modern league-phase format (36 teams, 8 matches, top 8
 * straight to the round of 16, 9-24 into a knockout play-off), then
 * two-legged knockouts and a single neutral final. No away goals; extra time
 * and penalties where ties are level. Deterministic from the share seed.
 */
import { createRng, cmp, type Rng } from "../rng";
import type { GameDataIndex } from "../data/game-data";
import type { GameClubSeason, GamePlayerSeason } from "../types";
import { SIM_VERSION } from "./version";
import { profileFromSeedPlayers, type TeamProfile } from "./strength";
import { simulateMatch, simulateExtraTime, type MatchResult, type SideInput } from "./engine";
import type { SeedPayload } from "../draft/seed";

export type Outcome =
  | "league-phase-exit"
  | "playoff-exit"
  | "r16-exit"
  | "qf-exit"
  | "sf-exit"
  | "runner-up"
  | "champion"
  | "unbeaten-champion"
  | "perfect-champion";

export const OUTCOME_LABEL: Record<Outcome, string> = {
  "league-phase-exit": "Eliminated in the league phase",
  "playoff-exit": "Eliminated in the knockout play-off",
  "r16-exit": "Eliminated in the round of 16",
  "qf-exit": "Eliminated in the quarter-final",
  "sf-exit": "Eliminated in the semi-final",
  "runner-up": "Runner-up",
  champion: "European Champion",
  "unbeaten-champion": "Unbeaten European Champion",
  "perfect-champion": "Perfect Campaign — European Royalty",
};

export interface Opponent {
  clubSeason: GameClubSeason;
  side: SideInput;
  pot: 1 | 2 | 3 | 4;
}

export interface PlayedMatch {
  label: string; // "League 3 (H)", "Semi-final, 1st leg", ...
  opponentName: string;
  home: boolean;
  result: MatchResult;
  userGoals: number;
  oppGoals: number;
}

export interface KnockoutTie {
  round: "playoff" | "r16" | "qf" | "sf" | "final";
  opponentName: string;
  legs: PlayedMatch[];
  aggregate: [number, number];
  pens: [number, number] | null;
  won: boolean;
}

export interface LeagueRow {
  name: string;
  isUser: boolean;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  gf: number;
  ga: number;
  points: number;
}

export interface CampaignResult {
  simVersion: string;
  outcome: Outcome;
  outcomeLabel: string;
  profile: TeamProfile;
  leagueMatches: PlayedMatch[];
  leagueRecord: { w: number; d: number; l: number; gf: number; ga: number; points: number; rank: number };
  table: LeagueRow[];
  knockout: KnockoutTie[];
  keyMoments: Array<{ stage: string; text: string }>;
}

function opponentSide(cs: GameClubSeason, index: GameDataIndex): SideInput {
  const s = cs.teamStrength;
  // real squad players for event attribution whenever the club-season has them
  const squad = cs.playerSeasonIds
    .map((id) => index.playerSeasonById.get(id))
    .filter(Boolean) as GamePlayerSeason[];
  const gk = squad.find((p) => p.posGroup === "GK");
  return {
    name: `${cs.clubName} ${cs.season}`,
    attack: s + 2,
    control: s,
    defense: s + 1,
    goalkeeping: s,
    clutch: s - 2,
    aura: cs.progression === "W" ? s + 6 : s,
    chemistry: 5,
    confidence: Math.max(0.7, cs.confidence.score),
    scorers: squad.length > 0 ? squad : undefined,
    keeperName: gk?.name,
  };
}

/** Draw 35 real historical opponents into 4 pots of strength. */
export function drawOpponents(rng: Rng, index: GameDataIndex, excludeClubSeasonIds: Set<string>): Opponent[] {
  const pool = index.data.clubSeasons
    .filter((c) => !excludeClubSeasonIds.has(c.id))
    .slice()
    .sort((a, b) => b.teamStrength - a.teamStrength || cmp(a.id, b.id));
  // strongest 300 candidates keep the field at UCL level, then split into pots
  const candidates = pool.slice(0, 300);
  const potSize = Math.floor(candidates.length / 4);
  const pots: GameClubSeason[][] = [
    candidates.slice(0, potSize),
    candidates.slice(potSize, potSize * 2),
    candidates.slice(potSize * 2, potSize * 3),
    candidates.slice(potSize * 3),
  ];
  const out: Opponent[] = [];
  const usedClubs = new Set<string>();
  for (let p = 0; p < 4; p++) {
    const need = p === 0 ? 8 : 9; // user occupies a pot-1 slot
    const shuffled = rng.shuffle(pots[p]);
    let taken = 0;
    for (const cs of shuffled) {
      if (taken >= need) break;
      if (usedClubs.has(cs.clubId)) continue; // one season per club in the field
      usedClubs.add(cs.clubId);
      out.push({ clubSeason: cs, side: opponentSide(cs, index), pot: (p + 1) as 1 | 2 | 3 | 4 });
      taken++;
    }
    // fallback if club-diversity starves a pot (cannot happen with 500 clubs, but stay safe)
    let i = 0;
    while (taken < need && i < shuffled.length) {
      const cs = shuffled[i++];
      if (out.some((o) => o.clubSeason.id === cs.id)) continue;
      out.push({ clubSeason: cs, side: opponentSide(cs, index), pot: (p + 1) as 1 | 2 | 3 | 4 });
      taken++;
    }
  }
  return out;
}

/** quick result for synthetic-vs-synthetic league matches (table filling) */
function quickResult(rng: Rng, a: SideInput, b: SideInput): [number, number] {
  const diff = (a.attack + a.control - b.defense - b.control) / 16;
  const xa = Math.max(0.2, 1.35 + diff * 0.8);
  const xb = Math.max(0.2, 1.15 - diff * 0.8);
  const pois = (l: number) => {
    const L = Math.exp(-l);
    let k = 0, p = 1;
    do {
      k++;
      p *= rng.next();
    } while (p > L && k < 10);
    return k - 1;
  };
  return [pois(xa), pois(xb)];
}

export function simulateCampaign(payload: SeedPayload, players: GamePlayerSeason[], index: GameDataIndex): CampaignResult {
  const rootRng = createRng(["campaign", SIM_VERSION, payload.dataVersion, payload.draftSeed, payload.formationId, payload.playerSeasonIds.join(",")].join("|"));
  const { profile } = profileFromSeedPlayers(payload.formationId, players, index);

  const userSide: SideInput = {
    name: "Your Immortal XI",
    attack: profile.attack,
    control: profile.control,
    defense: profile.defense,
    goalkeeping: profile.goalkeeping,
    clutch: profile.clutch,
    aura: profile.aura,
    chemistry: profile.chemistry,
    confidence: profile.avgConfidence,
    scorers: players,
  };

  const excluded = new Set(players.map((p) => p.clubSeasonId));
  const field = drawOpponents(rootRng.fork("draw"), index, excluded);

  // ---- league phase: user plays 2 per pot (1 home, 1 away) ----
  const fixtureRng = rootRng.fork("fixtures");
  const myOpponents: Array<{ opp: Opponent; home: boolean }> = [];
  for (let p = 1; p <= 4; p++) {
    const potOpps = fixtureRng.shuffle(field.filter((o) => o.pot === p)).slice(0, 2);
    myOpponents.push({ opp: potOpps[0], home: true }, { opp: potOpps[1], home: false });
  }
  const ordered = fixtureRng.shuffle(myOpponents);

  const leagueMatches: PlayedMatch[] = [];
  let w = 0, d = 0, l = 0, gf = 0, ga = 0;
  const keyMoments: Array<{ stage: string; text: string }> = [];

  ordered.forEach(({ opp, home }, i) => {
    const rng = rootRng.fork(`league-${i}`);
    const res = home
      ? simulateMatch(rng, userSide, opp.side, { homeBoost: 1.12 })
      : simulateMatch(rng, opp.side, userSide, { homeBoost: 1.12 });
    const ug = home ? res.goals[0] : res.goals[1];
    const og = home ? res.goals[1] : res.goals[0];
    gf += ug; ga += og;
    if (ug > og) w++;
    else if (ug === og) d++;
    else l++;
    leagueMatches.push({
      label: `League ${i + 1} (${home ? "H" : "A"})`,
      opponentName: opp.side.name,
      home,
      result: res,
      userGoals: ug,
      oppGoals: og,
    });
    if (ug - og >= 3) keyMoments.push({ stage: `League ${i + 1}`, text: `A ${ug}–${og} statement against ${opp.side.name}.` });
    if (og - ug >= 3) keyMoments.push({ stage: `League ${i + 1}`, text: `Humbled ${ug}–${og} by ${opp.side.name}.` });
  });
  const points = w * 3 + d;

  // ---- full table: every other team plays 8 quick matches ----
  const tableRng = rootRng.fork("table");
  const rows: LeagueRow[] = field.map((o) => ({
    name: o.side.name, isUser: false, played: 8, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, points: 0,
  }));
  for (let i = 0; i < field.length; i++) {
    // each synthetic team's remaining schedule vs deterministic sample of others
    const already = leagueMatches.filter((m) => m.opponentName === field[i].side.name).length;
    for (let k = already; k < 8; k++) {
      const j = tableRng.int(0, field.length - 1);
      if (j === i) { rows[i].drawn++; rows[i].points++; rows[i].gf++; rows[i].ga++; continue; }
      const [ga_, gb_] = quickResult(tableRng, field[i].side, field[j].side);
      rows[i].gf += ga_; rows[i].ga += gb_;
      if (ga_ > gb_) { rows[i].won++; rows[i].points += 3; }
      else if (ga_ === gb_) { rows[i].drawn++; rows[i].points++; }
      else rows[i].lost++;
    }
  }
  // fold the user's real results into opponents' rows
  for (const m of leagueMatches) {
    const row = rows.find((r) => r.name === m.opponentName)!;
    row.gf += m.oppGoals; row.ga += m.userGoals;
    if (m.oppGoals > m.userGoals) { row.won++; row.points += 3; }
    else if (m.oppGoals === m.userGoals) { row.drawn++; row.points++; }
    else row.lost++;
  }
  rows.push({ name: userSide.name, isUser: true, played: 8, won: w, drawn: d, lost: l, gf, ga, points });
  rows.sort((a, b) => b.points - a.points || (b.gf - b.ga) - (a.gf - a.ga) || b.gf - a.gf || cmp(a.name, b.name));
  const rank = rows.findIndex((r) => r.isUser) + 1;

  const result: CampaignResult = {
    simVersion: SIM_VERSION,
    outcome: "league-phase-exit",
    outcomeLabel: "",
    profile,
    leagueMatches,
    leagueRecord: { w, d, l, gf, ga, points, rank },
    table: rows,
    knockout: [],
    keyMoments,
  };

  if (rank > 24) {
    result.outcome = "league-phase-exit";
    result.outcomeLabel = OUTCOME_LABEL[result.outcome];
    keyMoments.push({ stage: "League phase", text: `Finished ${rank} of 36 — the campaign ends in the league phase.` });
    return result;
  }

  // ---- knockout opponent ladder: strongest remaining opponents by stage ----
  const koPoolRng = rootRng.fork("knockout-draw");
  const koPool = koPoolRng
    .shuffle(field.filter((o) => !leagueMatches.some((m) => m.opponentName === o.side.name)))
    .sort((a, b) => a.pot - b.pot);
  let koIdx = koPool.length - 1; // play-off draws from weaker pots first, final from pot 1
  const drawOpp = (round: KnockoutTie["round"]): Opponent => {
    const byRound: Record<string, number> = { playoff: 3, r16: 2, qf: 1, sf: 0, final: 0 };
    const targetPot = byRound[round];
    const candidates = koPool.filter((o) => o.pot - 1 >= targetPot);
    const pick = candidates.length ? candidates[koIdx % candidates.length] : koPool[koIdx % koPool.length];
    koIdx = (koIdx * 7 + 3) % Math.max(1, koPool.length);
    koPool.splice(koPool.indexOf(pick), 1);
    return pick;
  };

  const playTie = (round: KnockoutTie["round"], label: string): KnockoutTie => {
    const opp = drawOpp(round);
    if (round === "final") {
      const rng = rootRng.fork("final");
      const res = simulateMatch(rng, userSide, opp.side, { homeBoost: 1, mustDecide: true });
      return {
        round, opponentName: opp.side.name,
        legs: [{ label: "Final (neutral)", opponentName: opp.side.name, home: false, result: res, userGoals: res.goals[0], oppGoals: res.goals[1] }],
        aggregate: res.goals, pens: res.pens, won: res.winner === 0,
      };
    }
    const rng1 = rootRng.fork(`${round}-leg1`);
    const rng2 = rootRng.fork(`${round}-leg2`);
    const leg1 = simulateMatch(rng1, userSide, opp.side, { homeBoost: 1.12 }); // user at home first
    const agg1: [number, number] = [leg1.goals[0], leg1.goals[1]];
    // second leg away; decide tie on aggregate, ET+pens inside leg 2 if level
    const leg2pre = simulateMatch(rng2, opp.side, userSide, { homeBoost: 1.12 });
    let aggUser = agg1[0] + leg2pre.goals[1];
    let aggOpp = agg1[1] + leg2pre.goals[0];
    let leg2 = leg2pre;
    let pens: [number, number] | null = null;
    if (aggUser === aggOpp) {
      // ET-only decider (no regulation re-sim); side order [opp(home), user]
      const rngEt = rootRng.fork(`${round}-et`);
      const et = simulateExtraTime(rngEt, opp.side, userSide, 1.06);
      const [etOpp, etUser] = et.etGoals;
      aggUser += etUser;
      aggOpp += etOpp;
      leg2 = {
        ...leg2pre,
        goals: [leg2pre.goals[0] + etOpp, leg2pre.goals[1] + etUser],
        etGoals: [etOpp, etUser],
        events: [...leg2pre.events, ...et.events],
      };
      if (aggUser === aggOpp) {
        if (!et.pens) throw new Error("unreachable: level aggregate after ET without penalties");
        pens = [et.pens[1], et.pens[0]]; // normalize [opp, user] -> [user, opp]
      }
    }
    const won = aggUser > aggOpp || (pens !== null && pens[0] > pens[1]);
    return {
      round,
      opponentName: opp.side.name,
      legs: [
        { label: `${label}, 1st leg (H)`, opponentName: opp.side.name, home: true, result: leg1, userGoals: leg1.goals[0], oppGoals: leg1.goals[1] },
        { label: `${label}, 2nd leg (A)`, opponentName: opp.side.name, home: false, result: leg2, userGoals: leg2.goals[1], oppGoals: leg2.goals[0] },
      ],
      aggregate: [aggUser, aggOpp],
      pens,
      won,
    };
  };

  const ladder: Array<{ round: KnockoutTie["round"]; label: string; lossOutcome: Outcome }> = [];
  if (rank > 8) ladder.push({ round: "playoff", label: "Play-off", lossOutcome: "playoff-exit" });
  ladder.push(
    { round: "r16", label: "Round of 16", lossOutcome: "r16-exit" },
    { round: "qf", label: "Quarter-final", lossOutcome: "qf-exit" },
    { round: "sf", label: "Semi-final", lossOutcome: "sf-exit" },
    { round: "final", label: "Final", lossOutcome: "runner-up" },
  );

  keyMoments.push({
    stage: "League phase",
    text: rank <= 8
      ? `Finished ${rank} of 36 — straight into the round of 16.`
      : `Finished ${rank} of 36 — into the knockout play-off.`,
  });

  for (const step of ladder) {
    const tie = playTie(step.round, step.label);
    result.knockout.push(tie);
    const aggText = tie.legs.length === 2 ? ` (agg ${tie.aggregate[0]}–${tie.aggregate[1]})` : ` ${tie.aggregate[0]}–${tie.aggregate[1]}`;
    if (!tie.won) {
      result.outcome = step.lossOutcome;
      result.outcomeLabel = OUTCOME_LABEL[result.outcome];
      keyMoments.push({ stage: step.label, text: `Beaten by ${tie.opponentName}${aggText}${tie.pens ? ` — ${tie.pens[0]}–${tie.pens[1]} on penalties` : ""}.` });
      return result;
    }
    keyMoments.push({ stage: step.label, text: `Past ${tie.opponentName}${aggText}${tie.pens ? ` — ${tie.pens[0]}–${tie.pens[1]} on penalties` : ""}.` });
  }

  // champion — grade it
  const koMatches = result.knockout.flatMap((t) => t.legs);
  const allMatches = [...leagueMatches, ...koMatches];
  const anyLoss = l > 0 || koMatches.some((m) => m.userGoals < m.oppGoals);
  const allWon = allMatches.every((m) => m.userGoals > m.oppGoals);
  result.outcome = allWon ? "perfect-champion" : anyLoss ? "champion" : "unbeaten-champion";
  result.outcomeLabel = OUTCOME_LABEL[result.outcome];
  keyMoments.push({ stage: "Final", text: "The cup with the big ears belongs to your Immortal XI." });
  return result;
}
