import { beforeAll, describe, expect, it } from "vitest";
import { loadGameData, type GameDataIndex } from "../lib/data/game-data";
import { simulateMatch, keeperNameOf, type SideInput } from "../lib/simulation/engine";
import {
  advance,
  clockDone,
  matchDone,
  liveScore,
  visibleEvents,
  visibleKicks,
  skipToEnd,
  fullTimeMinute,
  type LiveState,
} from "../lib/simulation/live";
import { simulateCampaign } from "../lib/simulation/campaign";
import { createRng } from "../lib/rng";
import { decodeSeed, encodeSeed } from "../lib/draft/seed";
import { SIM_VERSION } from "../lib/simulation/version";
import { autoDraft } from "./draft.test";

let index: GameDataIndex;
beforeAll(async () => {
  index = await loadGameData();
});

function realSide(label: string, seedKey: string): SideInput {
  const { payload } = autoDraft(seedKey);
  const players = payload.playerSeasonIds.map((id) => index.playerSeasonById.get(id)!);
  return {
    name: label,
    attack: 85, control: 84, defense: 84, goalkeeping: 86, clutch: 84, aura: 84,
    chemistry: 5, confidence: 0.9,
    scorers: players,
    keeperName: players.find((p) => p.posGroup === "GK")?.name,
  };
}

describe("player-specific events", () => {
  it("goals name a real squad member; saves name the actual keeper", () => {
    const a = realSide("Alpha", "evt-A");
    const b = realSide("Beta", "evt-B");
    const namesA = new Set(a.scorers!.map((p) => p.name));
    const namesB = new Set(b.scorers!.map((p) => p.name));
    let goals = 0;
    let saves = 0;
    for (let i = 0; i < 25; i++) {
      const r = simulateMatch(createRng(`evt-${i}`), a, b, { mustDecide: true });
      for (const e of r.events) {
        if (e.type === "goal" || e.type === "penalty-goal") {
          goals++;
          expect(e.scorerName).toBeTruthy();
          expect((e.side === 0 ? namesA : namesB).has(e.scorerName!)).toBe(true);
        }
        if (e.type === "save") {
          saves++;
          const keeper = e.side === 0 ? keeperNameOf(a) : keeperNameOf(b);
          expect(e.text).toContain(keeper);
          expect(e.text).not.toContain("'s keeper");
        }
      }
      for (const k of r.penKicks ?? []) {
        expect((k.side === 0 ? namesA : namesB).has(k.taker)).toBe(true);
      }
    }
    expect(goals).toBeGreaterThan(0);
    expect(saves).toBeGreaterThan(0);
  });

  it("opponent events use real opponent names when their squad exists", () => {
    const { payload } = autoDraft("opp-naming");
    const d = decodeSeed(encodeSeed(payload, index), index, SIM_VERSION);
    if (!d.ok) throw new Error(d.error);
    const c = simulateCampaign(d.payload, d.players, index);
    const byLabel = new Map(index.data.clubSeasons.map((cs) => [`${cs.clubName} ${cs.season}`, cs]));
    let checkedOppGoals = 0;
    for (const m of [...c.leagueMatches, ...c.knockout.flatMap((t) => t.legs)]) {
      const cs = byLabel.get(m.opponentName);
      if (!cs || cs.playerSeasonIds.length === 0) continue;
      const oppNames = new Set(cs.playerSeasonIds.map((id) => index.playerSeasonById.get(id)!.name));
      const oppIdx = m.home ? 1 : 0;
      for (const e of m.result.events) {
        if (e.side === oppIdx && (e.type === "goal" || e.type === "penalty-goal")) {
          expect(e.scorerName).toBeTruthy();
          expect(oppNames.has(e.scorerName!)).toBe(true);
          checkedOppGoals++;
        }
      }
    }
    expect(checkedOppGoals).toBeGreaterThan(0);
  });

  it("squadless opponents fall back to role labels, never bare club-name strikes", () => {
    const side = (s: number): SideInput => ({
      name: "Mystery 1971-72", attack: s, control: s, defense: s, goalkeeping: s,
      clutch: s, aura: s, chemistry: 5, confidence: 0.8,
    });
    for (let i = 0; i < 15; i++) {
      const r = simulateMatch(createRng(`fallback-${i}`), side(85), side(70), { mustDecide: true });
      for (const e of r.events) {
        if (e.type === "goal") expect(e.text).toMatch(/their (centre-forward|winger|playmaker)/);
        if (e.type === "save") expect(e.text).toContain("their goalkeeper");
      }
    }
  });
});

describe("live clock reveal", () => {
  const a = (): SideInput => realSide("A", "live-A");
  const b = (): SideInput => realSide("B", "live-B");

  it("never reveals the final score before full time", () => {
    for (let i = 0; i < 30; i++) {
      const r = simulateMatch(createRng(`live-${i}`), a(), b(), { mustDecide: true });
      const ft = fullTimeMinute(r);
      let st: LiveState = { minute: 0, kicksRevealed: 0 };
      let prev: [number, number] = [0, 0];
      while (!matchDone(st, r)) {
        const sc = liveScore(st, r);
        expect(sc[0]).toBeGreaterThanOrEqual(prev[0]);
        expect(sc[1]).toBeGreaterThanOrEqual(prev[1]);
        expect(sc[0]).toBeLessThanOrEqual(r.goals[0]);
        expect(sc[1]).toBeLessThanOrEqual(r.goals[1]);
        for (const e of visibleEvents(st, r)) expect(e.minute).toBeLessThanOrEqual(st.minute);
        prev = sc;
        st = advance(st, r);
        expect(st.minute).toBeLessThanOrEqual(ft);
      }
      expect(liveScore(st, r)).toEqual(r.goals);
      if (r.penKicks) expect(visibleKicks(st, r)).toHaveLength(r.penKicks.length);
    }
  });

  it("penalties reveal one kick at a time after 120'", () => {
    // find a deterministic shootout
    let found = false;
    for (let i = 0; i < 200 && !found; i++) {
      const r = simulateMatch(createRng(`pens-${i}`), a(), b(), { mustDecide: true });
      if (!r.penKicks) continue;
      found = true;
      let st = { minute: fullTimeMinute(r), kicksRevealed: 0 };
      expect(clockDone(st, r)).toBe(true);
      for (let k = 1; k <= r.penKicks.length; k++) {
        st = advance(st, r);
        expect(visibleKicks(st, r)).toHaveLength(k);
      }
      expect(matchDone(st, r)).toBe(true);
    }
    expect(found).toBe(true);
  });

  it("skipToEnd matches the full deterministic result; speed never changes outcome", () => {
    const r1 = simulateMatch(createRng("speed-x"), a(), b(), { mustDecide: true });
    const r2 = simulateMatch(createRng("speed-x"), a(), b(), { mustDecide: true });
    expect(JSON.stringify(r1)).toEqual(JSON.stringify(r2)); // incl. penKicks + named events
    const end = skipToEnd(r1);
    expect(liveScore(end, r1)).toEqual(r1.goals);
    expect(visibleEvents(end, r1)).toHaveLength(r1.events.length);
  });
});
