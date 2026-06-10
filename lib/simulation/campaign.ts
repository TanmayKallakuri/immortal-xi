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
  opponentClubSeasonId: string;
  /** historical teamStrength of the opponent club-season (audit/UI) */
  opponentStrength: number;
  home: boolean;
  result: MatchResult;
  userGoals: number;
  oppGoals: number;
}

export interface KnockoutTie {
  round: "playoff" | "r16" | "qf" | "sf" | "final";
  opponentName: string;
  opponentClubSeasonId: string;
  opponentStrength: number;
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

/** Squad-shape deltas: a real squad's positional strengths re-centered so the
 *  headline difficulty stays teamStrength while the SHAPE follows the actual
 *  players (Milan 88/89 defends like Milan, not like a generic 90). */
function squadShape(squad: GamePlayerSeason[]): { atk: number; ctl: number; def: number; gk: number } {
  const topMean = (vals: number[], n: number): number | null => {
    if (vals.length === 0) return null;
    const top = [...vals].sort((a, b) => b - a).slice(0, n);
    return top.reduce((s, v) => s + v, 0) / top.length;
  };
  const outfield = squad.filter((p) => p.posGroup !== "GK");
  const atk = topMean(squad.filter((p) => p.posGroup === "FW" || p.posGroup === "MF").map((p) => p.ratings.attack), 4);
  const ctl = topMean((squad.some((p) => p.posGroup === "MF") ? squad.filter((p) => p.posGroup === "MF") : outfield).map((p) => p.ratings.control), 4);
  const def = topMean(squad.filter((p) => p.posGroup === "DF").map((p) => p.ratings.defense), 4);
  const gk = topMean(squad.filter((p) => p.posGroup === "GK").map((p) => p.ratings.goalkeeping), 1);
  if (atk === null || ctl === null || def === null || gk === null) return { atk: 0, ctl: 0, def: 0, gk: 0 };
  const m = (atk + ctl + def + gk) / 4;
  const d = (v: number) => Math.max(-4, Math.min(4, (v - m) * 0.5));
  return { atk: d(atk), ctl: d(ctl), def: d(def), gk: d(gk) };
}

/** teamStrength (66..96, the historical-tier scale) mapped onto the SAME
 *  scale the user's XI profile lives on. The profile aggregation weights
 *  ratings by position and slot fit, which compresses even an all-legend XI
 *  to the low/mid 80s — so raw teamStrength would overstate opponents by
 *  ~10 points at the top. Calibrated so an elite final opponent (~92-95)
 *  matches a world-class drafted XI, and a league-pot opponent (~78) sits
 *  where a decent XI is favored. */
export function opponentProfileBase(teamStrength: number): number {
  return 66 + (teamStrength - 66) * 0.66;
}

function opponentSide(cs: GameClubSeason, index: GameDataIndex): SideInput {
  const b = opponentProfileBase(cs.teamStrength);
  // real squad players for event attribution whenever the club-season has them
  const squad = cs.playerSeasonIds
    .map((id) => index.playerSeasonById.get(id))
    .filter(Boolean) as GamePlayerSeason[];
  const gk = squad.find((p) => p.posGroup === "GK");
  const shape = squad.length >= 11 ? squadShape(squad) : { atk: 0, ctl: 0, def: 0, gk: 0 };
  return {
    name: `${cs.clubName} ${cs.season}`,
    attack: b + 2 + shape.atk,
    control: b + shape.ctl,
    defense: b + 1 + shape.def,
    goalkeeping: b + shape.gk,
    clutch: cs.progression === "W" ? b : b - 2,
    aura: cs.progression === "W" ? b + 6 : cs.progression === "RU" ? b + 3 : b,
    chemistry: 5,
    confidence: Math.max(0.7, cs.confidence.score),
    scorers: squad.length > 0 ? squad : undefined,
    keeperName: gk?.name,
  };
}

/** League-phase pot bands: a BROAD mix of tiers — a few elites at the top,
 *  capable mid-tier in the middle, genuine minnows in pot 4. */
export const LEAGUE_POT_BANDS: Array<{ min: number; max: number }> = [
  { min: 84, max: 96 }, // pot 1: champions / elite finalists
  { min: 78, max: 85 }, // pot 2: finalist / deep-run grade
  { min: 72, max: 79 }, // pot 3: knockout-capable
  { min: 60, max: 75 }, // pot 4: group-stage grade and minnows
];

/** Draw 35 real historical opponents into 4 pots of strength. */
export function drawOpponents(rng: Rng, index: GameDataIndex, excludeClubSeasonIds: Set<string>): Opponent[] {
  const pool = index.data.clubSeasons
    .filter((c) => !excludeClubSeasonIds.has(c.id))
    .slice()
    .sort((a, b) => b.teamStrength - a.teamStrength || cmp(a.id, b.id));
  const out: Opponent[] = [];
  const usedClubs = new Set<string>();
  const usedIds = new Set<string>();
  for (let p = 0; p < 4; p++) {
    const need = p === 0 ? 8 : 9; // user occupies a pot-1 slot
    const band = LEAGUE_POT_BANDS[p];
    const inBand = pool.filter((cs) => cs.teamStrength >= band.min && cs.teamStrength <= band.max && !usedIds.has(cs.id));
    const shuffled = rng.shuffle(inBand);
    let taken = 0;
    for (const cs of shuffled) {
      if (taken >= need) break;
      if (usedClubs.has(cs.clubId)) continue; // one season per club in the field
      usedClubs.add(cs.clubId);
      usedIds.add(cs.id);
      out.push({ clubSeason: cs, side: opponentSide(cs, index), pot: (p + 1) as 1 | 2 | 3 | 4 });
      taken++;
    }
    // fallback if club-diversity starves a pot (cannot happen with 500 clubs, but stay safe)
    let i = 0;
    while (taken < need && i < shuffled.length) {
      const cs = shuffled[i++];
      if (usedIds.has(cs.id)) continue;
      usedIds.add(cs.id);
      out.push({ clubSeason: cs, side: opponentSide(cs, index), pot: (p + 1) as 1 | 2 | 3 | 4 });
      taken++;
    }
  }
  return out;
}

/** Stage-aware knockout opponent bands: the deeper the run, the more elite
 *  the historical opposition. Targets are centers of weighted randomness,
 *  not fixed lists — variety stays, escalation is guaranteed. */
export const STAGE_BANDS: Record<KnockoutTie["round"], { min: number; max: number; target: number }> = {
  playoff: { min: 74, max: 84, target: 79 },
  r16: { min: 78, max: 88, target: 83 },
  qf: { min: 82, max: 91, target: 87 },
  sf: { min: 85, max: 93, target: 89 },
  final: { min: 88, max: 95, target: 92 },
};

/** historical-pedigree multiplier, scaled up in later rounds so the final is
 *  heavily weighted toward champions/finalists and elite iconic sides */
const CATEGORY_ELITE_BONUS: Record<string, number> = {
  champion: 0.5,
  runner_up: 0.3,
  semi_finalist: 0.15,
  group_stage_iconic: 0.1,
  league_phase_iconic: 0.1,
};
const STAGE_ELITE_FACTOR: Record<KnockoutTie["round"], number> = {
  playoff: 0.2,
  r16: 0.4,
  qf: 0.8,
  sf: 1.0,
  final: 1.3,
};

/**
 * Draw one knockout opponent from the FULL historical pool (not just the
 * league field): weighted toward the stage's strength band and, in late
 * rounds, toward historical champions/finalists. Deterministic from the rng
 * stream. Excludes the user's drafted club-seasons and already-faced clubs;
 * both constraints relax (in that order: band first, then club repeats)
 * only if the pool starves.
 */
export function drawKnockoutOpponent(
  rng: Rng,
  index: GameDataIndex,
  round: KnockoutTie["round"],
  excludeClubSeasonIds: Set<string>,
  facedClubIds: Set<string>,
  facedEras: Map<string, number>,
): GameClubSeason {
  const band = STAGE_BANDS[round];
  const base = index.data.clubSeasons.filter((cs) => !excludeClubSeasonIds.has(cs.id));
  let candidates = base.filter(
    (cs) => cs.teamStrength >= band.min - 2 && cs.teamStrength <= band.max + 2 && !facedClubIds.has(cs.clubId),
  );
  if (candidates.length < 4) {
    // rare: allow a same-club different-era collision before widening the band
    candidates = base.filter((cs) => cs.teamStrength >= band.min - 2 && cs.teamStrength <= band.max + 2);
  }
  if (candidates.length < 4) {
    candidates = base.filter((cs) => cs.teamStrength >= band.min - 6);
  }
  if (candidates.length === 0) candidates = base;

  const weights = candidates.map((cs) => {
    const bandFit = Math.exp(-(((cs.teamStrength - band.target) / 4) ** 2));
    const elite = 1 + (CATEGORY_ELITE_BONUS[cs.category] ?? 0) * STAGE_ELITE_FACTOR[round];
    const squadDepth = cs.playerSeasonIds.length >= 11 ? 1.25 : 0.85;
    const dataConfidence = 0.85 + 0.3 * cs.confidence.score;
    const eraVariety = (facedEras.get(cs.eraLabel) ?? 0) > 0 ? 0.85 : 1;
    return Math.max(1e-6, bandFit * elite * squadDepth * dataConfidence * eraVariety);
  });
  return rng.weighted(candidates, weights);
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
      opponentClubSeasonId: opp.clubSeason.id,
      opponentStrength: opp.clubSeason.teamStrength,
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

  // ---- knockout opponent ladder: stage-aware draw from the FULL pool ----
  // Each round draws from all historical club-seasons via STAGE_BANDS, so
  // late rounds escalate toward elite opposition. Excluded: the user's
  // drafted club-seasons, clubs already faced this campaign, and field teams
  // eliminated in the league phase (they cannot reappear in knockouts).
  const koExcluded = new Set(excluded);
  const facedClubIds = new Set<string>();
  const facedEras = new Map<string, number>();
  for (const m of leagueMatches) {
    const opp = field.find((o) => o.side.name === m.opponentName);
    if (opp) {
      facedClubIds.add(opp.clubSeason.clubId);
      koExcluded.add(opp.clubSeason.id);
    }
  }
  // ranks 25-36 are out (the user is <= 24 here, or we returned above)
  const eliminatedRows = new Set(rows.slice(24).map((r) => r.name));
  for (const o of field) {
    if (eliminatedRows.has(o.side.name)) koExcluded.add(o.clubSeason.id);
  }
  const drawOpp = (round: KnockoutTie["round"]): Opponent => {
    const cs = drawKnockoutOpponent(
      rootRng.fork(`ko-draw-${round}`),
      index,
      round,
      koExcluded,
      facedClubIds,
      facedEras,
    );
    koExcluded.add(cs.id);
    facedClubIds.add(cs.clubId);
    facedEras.set(cs.eraLabel, (facedEras.get(cs.eraLabel) ?? 0) + 1);
    return { clubSeason: cs, side: opponentSide(cs, index), pot: 1 };
  };

  const playTie = (round: KnockoutTie["round"], label: string): KnockoutTie => {
    const opp = drawOpp(round);
    const oppStrength = opp.clubSeason.teamStrength;
    const oppCsId = opp.clubSeason.id;
    if (round === "final") {
      const rng = rootRng.fork("final");
      const res = simulateMatch(rng, userSide, opp.side, { homeBoost: 1, mustDecide: true });
      return {
        round, opponentName: opp.side.name, opponentClubSeasonId: oppCsId, opponentStrength: oppStrength,
        legs: [{ label: "Final (neutral)", opponentName: opp.side.name, opponentClubSeasonId: oppCsId, opponentStrength: oppStrength, home: false, result: res, userGoals: res.goals[0], oppGoals: res.goals[1] }],
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
      opponentClubSeasonId: oppCsId,
      opponentStrength: oppStrength,
      legs: [
        { label: `${label}, 1st leg (H)`, opponentName: opp.side.name, opponentClubSeasonId: oppCsId, opponentStrength: oppStrength, home: true, result: leg1, userGoals: leg1.goals[0], oppGoals: leg1.goals[1] },
        { label: `${label}, 2nd leg (A)`, opponentName: opp.side.name, opponentClubSeasonId: oppCsId, opponentStrength: oppStrength, home: false, result: leg2, userGoals: leg2.goals[1], oppGoals: leg2.goals[0] },
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
