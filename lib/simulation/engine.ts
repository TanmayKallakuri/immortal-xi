/**
 * Match engine: expected-goals model + seeded Poisson goal generation +
 * narrative event timeline. Fully deterministic for a given Rng stream.
 */
import type { Rng } from "../rng";
import type { GamePlayerSeason } from "../types";

export interface SideInput {
  name: string;
  attack: number;
  control: number;
  defense: number;
  goalkeeping: number;
  clutch: number;
  aura: number;
  chemistry: number;
  /** 0..1 — lower confidence widens variance (old data is uncertain, not bad) */
  confidence: number;
  /** outfield players for scorer attribution; empty for synthetic opponents */
  scorers?: GamePlayerSeason[];
}

export interface MatchEvent {
  minute: number;
  type: "goal" | "penalty-goal" | "save" | "chance" | "drama";
  side: 0 | 1;
  text: string;
  scorerName?: string;
}

export interface MatchResult {
  goals: [number, number];
  etGoals: [number, number] | null; // additional goals in extra time
  pens: [number, number] | null;
  xg: [number, number];
  events: MatchEvent[];
  winner: 0 | 1 | null; // null = draw (after 90 only when draws allowed)
}

const logistic = (x: number) => 1 / (1 + Math.exp(-x));

/** Expected goals for side A against side B. Neutral baseline ~1.35. */
export function expectedGoals(a: SideInput, b: SideInput, homeBoost: number): number {
  const attackPower = a.attack + a.control * 0.45 + a.chemistry * 0.6 + a.aura * 0.12;
  const defensePower = b.defense + b.goalkeeping * 0.55 + b.chemistry * 0.5 + b.control * 0.2;
  const diff = (attackPower - defensePower) / 14;
  const base = 0.45 + 2.4 * logistic(diff);
  return Math.max(0.15, Math.min(4.2, base * homeBoost));
}

function poisson(rng: Rng, lambda: number): number {
  const L = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= rng.next();
  } while (p > L && k < 12);
  return k - 1;
}

/** variance widening for low-confidence sides: nudges lambda deterministically */
function uncertainty(rng: Rng, side: SideInput): number {
  const sigma = (1 - side.confidence) * 0.5;
  return 1 + rng.gauss() * sigma * 0.25;
}

function pickScorer(rng: Rng, side: SideInput): string | undefined {
  if (!side.scorers || side.scorers.length === 0) return undefined;
  const outfield = side.scorers.filter((p) => p.posGroup !== "GK");
  if (outfield.length === 0) return undefined;
  const weights = outfield.map((p) => Math.max(1, p.ratings.attack - 50));
  return rng.weighted(outfield, weights).name;
}

function goalText(rng: Rng, scorer: string | undefined, team: string, minute: number): string {
  const generic = [
    `${team} carve through and finish coolly`,
    `A roar around the ground — ${team} strike`,
    `Half-chance, full punishment by ${team}`,
    `${team} convert from a corner-kick scramble`,
    `Counter-attack at pace, finished low into the corner`,
  ];
  const named = [
    `${scorer} finishes a sweeping move`,
    `${scorer} rises highest and heads it in`,
    `${scorer} arrives late in the box and slots home`,
    `${scorer} smashes it first-time past the keeper`,
    `${scorer} dances past two and rolls it in`,
  ];
  const pool = scorer ? named : generic;
  const t = rng.pick(pool);
  return minute >= 88 ? `${t} — bedlam this late!` : t;
}

function simulatePeriod(
  rng: Rng,
  a: SideInput,
  b: SideInput,
  opts: { minutes: [number, number]; xgScale: number; homeBoost: number },
): { goals: [number, number]; xg: [number, number]; events: MatchEvent[] } {
  const xgA = expectedGoals(a, b, opts.homeBoost) * opts.xgScale * uncertainty(rng, a);
  const xgB = expectedGoals(b, a, 1) * opts.xgScale * uncertainty(rng, b);
  const gA = poisson(rng, xgA);
  const gB = poisson(rng, xgB);
  const events: MatchEvent[] = [];
  const [mStart, mEnd] = opts.minutes;
  const span = mEnd - mStart;

  const addGoals = (side: 0 | 1, n: number, input: SideInput) => {
    for (let i = 0; i < n; i++) {
      // clutch sides score later; deterministic from rng stream
      const lateBias = input.clutch >= 80 ? 0.25 : 0;
      const minute = Math.min(mEnd, Math.round(mStart + rng.next() * span + lateBias * span * rng.next()));
      const isPen = rng.next() < 0.11;
      const scorer = pickScorer(rng, input);
      events.push({
        minute,
        type: isPen ? "penalty-goal" : "goal",
        side,
        scorerName: scorer,
        text: isPen
          ? `${scorer ?? input.name} converts from the spot`
          : goalText(rng, scorer, input.name, minute),
      });
    }
  };
  addGoals(0, gA, a);
  addGoals(1, gB, b);

  // flavour events
  const nSaves = rng.int(0, 2);
  for (let i = 0; i < nSaves; i++) {
    const side = rng.next() < 0.5 ? 0 : 1;
    const keeperSide = side === 0 ? a : b;
    if (keeperSide.goalkeeping >= 82) {
      events.push({
        minute: rng.int(mStart, mEnd),
        type: "save",
        side,
        text: `${keeperSide.name}'s keeper claws one off the line`,
      });
    }
  }
  if (Math.abs(gA - gB) >= 3) {
    events.push({
      minute: mEnd - rng.int(2, 8),
      type: "drama",
      side: gA > gB ? 0 : 1,
      text: "The stands are bouncing — this is a statement performance",
    });
  }
  events.sort((x, y) => x.minute - y.minute);
  return { goals: [gA, gB], xg: [Math.round(xgA * 100) / 100, Math.round(xgB * 100) / 100], events };
}

export interface SimulateMatchOptions {
  /** 1.12 for home side A in a two-legged tie; 1 on neutral ground */
  homeBoost?: number;
  /** if drawn after 90', go to extra time + penalties */
  mustDecide?: boolean;
}

export function simulateMatch(rng: Rng, a: SideInput, b: SideInput, opts: SimulateMatchOptions = {}): MatchResult {
  const homeBoost = opts.homeBoost ?? 1;
  const main = simulatePeriod(rng, a, b, { minutes: [1, 90], xgScale: 1, homeBoost });
  let goals: [number, number] = [...main.goals] as [number, number];
  const events = [...main.events];
  let etGoals: [number, number] | null = null;
  let pens: [number, number] | null = null;

  if (opts.mustDecide && goals[0] === goals[1]) {
    const et = simulatePeriod(rng, a, b, { minutes: [91, 120], xgScale: 0.34, homeBoost });
    etGoals = et.goals;
    events.push(...et.events);
    goals = [goals[0] + et.goals[0], goals[1] + et.goals[1]];
    if (goals[0] === goals[1]) {
      pens = shootout(rng, a, b);
      events.push({
        minute: 120,
        type: "drama",
        side: pens[0] > pens[1] ? 0 : 1,
        text: `Penalties: ${pens[0]}–${pens[1]} — heroes and heartbreak from twelve yards`,
      });
    }
  }

  const winner: MatchResult["winner"] =
    goals[0] !== goals[1]
      ? goals[0] > goals[1] ? 0 : 1
      : pens
        ? pens[0] > pens[1] ? 0 : 1
        : null;

  return { goals, etGoals, pens, xg: main.xg, events, winner };
}

export interface ExtraTimeResult {
  /** goals scored during ET only, [a, b] */
  etGoals: [number, number];
  /** present iff ET finished level */
  pens: [number, number] | null;
  events: MatchEvent[];
  winner: 0 | 1;
}

/**
 * Extra time + (if still level) penalties, WITHOUT a preceding regulation
 * period. Used to decide two-legged ties that are level on aggregate after
 * 180 minutes: if ET goals are equal the aggregate stays equal, so pens
 * decide; if unequal, the ET goals decide the aggregate.
 */
export function simulateExtraTime(rng: Rng, a: SideInput, b: SideInput, homeBoost = 1): ExtraTimeResult {
  const et = simulatePeriod(rng, a, b, { minutes: [91, 120], xgScale: 0.34, homeBoost });
  const events = [...et.events];
  let pens: [number, number] | null = null;
  if (et.goals[0] === et.goals[1]) {
    pens = shootout(rng, a, b);
    events.push({
      minute: 120,
      type: "drama",
      side: pens[0] > pens[1] ? 0 : 1,
      text: `Penalties: ${pens[0]}–${pens[1]} — heroes and heartbreak from twelve yards`,
    });
  }
  const winner: 0 | 1 =
    et.goals[0] !== et.goals[1]
      ? et.goals[0] > et.goals[1] ? 0 : 1
      : pens![0] > pens![1] ? 0 : 1;
  return { etGoals: et.goals, pens, events, winner };
}

export function shootout(rng: Rng, a: SideInput, b: SideInput): [number, number] {
  const conv = (taker: SideInput, keeper: SideInput) =>
    0.62 + (taker.clutch - 70) * 0.004 - (keeper.goalkeeping - 80) * 0.004;
  let sa = 0;
  let sb = 0;
  for (let k = 0; k < 5; k++) {
    if (rng.next() < conv(a, b)) sa++;
    if (rng.next() < conv(b, a)) sb++;
  }
  // sudden death
  let guard = 0;
  while (sa === sb && guard++ < 20) {
    const ka = rng.next() < conv(a, b);
    const kb = rng.next() < conv(b, a);
    if (ka) sa++;
    if (kb) sb++;
  }
  if (sa === sb) sa++; // theoretical guard: home team nerve holds
  return [sa, sb];
}
