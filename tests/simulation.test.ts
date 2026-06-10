import { beforeAll, describe, expect, it } from "vitest";
import { loadGameData, type GameDataIndex } from "../lib/data/game-data";
import { simulateCampaign, STAGE_BANDS, type KnockoutTie } from "../lib/simulation/campaign";
import { buildSide, simulateH2h } from "../lib/simulation/h2h";
import { detectBadges } from "../lib/simulation/badges";
import { simulateMatch, simulateExtraTime } from "../lib/simulation/engine";
import { createRng } from "../lib/rng";
import { decodeSeed, encodeSeed } from "../lib/draft/seed";
import { SIM_VERSION } from "../lib/simulation/version";
import { autoDraft } from "./draft.test";

let index: GameDataIndex;

beforeAll(async () => {
  index = await loadGameData();
});

const side = (name: string, s: number) => ({
  name,
  attack: s, control: s, defense: s, goalkeeping: s, clutch: s, aura: s,
  chemistry: 5, confidence: 0.9,
});

describe("match engine", () => {
  it("is deterministic per rng seed", () => {
    const r1 = simulateMatch(createRng("m1"), side("A", 85), side("B", 80), { mustDecide: true });
    const r2 = simulateMatch(createRng("m1"), side("A", 85), side("B", 80), { mustDecide: true });
    expect(r1).toEqual(r2);
  });

  it("always decides when mustDecide", () => {
    for (let i = 0; i < 60; i++) {
      const r = simulateMatch(createRng(`decide-${i}`), side("A", 82), side("B", 82), { mustDecide: true });
      expect(r.winner).not.toBeNull();
      if (r.pens) expect(r.pens[0]).not.toEqual(r.pens[1]);
    }
  });

  it("ET-only decider: deterministic, pens iff level, never a canned result", () => {
    let sawPens = false;
    let sawEtWinner = false;
    const seenPens = new Set<string>();
    for (let i = 0; i < 120; i++) {
      const r1 = simulateExtraTime(createRng(`et-${i}`), side("A", 84), side("B", 84), 1.06);
      const r2 = simulateExtraTime(createRng(`et-${i}`), side("A", 84), side("B", 84), 1.06);
      expect(r1).toEqual(r2);
      if (r1.etGoals[0] === r1.etGoals[1]) {
        expect(r1.pens).not.toBeNull();
        expect(r1.pens![0]).not.toEqual(r1.pens![1]);
        expect(r1.winner).toBe(r1.pens![0] > r1.pens![1] ? 0 : 1);
        seenPens.add(r1.pens!.join("-"));
        sawPens = true;
      } else {
        expect(r1.pens).toBeNull();
        expect(r1.winner).toBe(r1.etGoals[0] > r1.etGoals[1] ? 0 : 1);
        sawEtWinner = true;
      }
    }
    expect(sawPens).toBe(true);
    expect(sawEtWinner).toBe(true);
    expect(seenPens.size).toBeGreaterThan(1); // regression: 1.0.0 could hardcode 4-3
  });

  it("stronger sides win more over many seeds", () => {
    let strongWins = 0;
    const n = 150;
    for (let i = 0; i < n; i++) {
      const r = simulateMatch(createRng(`bias-${i}`), side("Strong", 92), side("Weak", 68), { mustDecide: true });
      if (r.winner === 0) strongWins++;
    }
    expect(strongWins / n).toBeGreaterThan(0.75);
  });
});

describe("campaign", () => {
  it("same seed + sim version => identical campaign", () => {
    const { payload } = autoDraft("camp-det");
    const seed = encodeSeed(payload, index);
    const d = decodeSeed(seed, index, SIM_VERSION);
    expect(d.ok).toBe(true);
    if (!d.ok) return;
    const a = simulateCampaign(d.payload, d.players, index);
    const b = simulateCampaign(d.payload, d.players, index);
    expect(JSON.stringify(a)).toEqual(JSON.stringify(b));
  });

  it("league phase plays exactly 8 matches and qualification follows rank", () => {
    for (const s of ["q1", "q2", "q3", "q4", "q5", "q6"]) {
      const { payload } = autoDraft(s);
      const d = decodeSeed(encodeSeed(payload, index), index, SIM_VERSION);
      if (!d.ok) throw new Error(d.error);
      const c = simulateCampaign(d.payload, d.players, index);
      expect(c.leagueMatches).toHaveLength(8);
      expect(c.table).toHaveLength(36);
      const rank = c.leagueRecord.rank;
      if (rank > 24) {
        expect(c.outcome).toBe("league-phase-exit");
        expect(c.knockout).toHaveLength(0);
      } else if (rank > 8) {
        expect(c.knockout[0]?.round).toBe("playoff");
      } else if (c.knockout.length > 0) {
        expect(c.knockout[0]?.round).toBe("r16");
      }
      // points must equal 3w + d
      expect(c.leagueRecord.points).toBe(c.leagueRecord.w * 3 + c.leagueRecord.d);
    }
  });

  it("knockout ties resolve by aggregate, with pens only when level", () => {
    for (const s of ["k1", "k2", "k3", "k4", "k5", "k6", "k7", "k8"]) {
      const { payload } = autoDraft(s);
      const d = decodeSeed(encodeSeed(payload, index), index, SIM_VERSION);
      if (!d.ok) throw new Error(d.error);
      const c = simulateCampaign(d.payload, d.players, index);
      for (const tie of c.knockout) {
        if (tie.pens) {
          expect(tie.aggregate[0]).toEqual(tie.aggregate[1]);
          expect(tie.won).toBe(tie.pens[0] > tie.pens[1]);
          if (tie.round !== "final") {
            expect(tie.legs[1].result.etGoals).not.toBeNull(); // ET visibly happened
          }
        } else {
          expect(tie.won).toBe(tie.aggregate[0] > tie.aggregate[1]);
        }
        if (tie.round !== "final") {
          expect(tie.legs).toHaveLength(2);
          expect(tie.aggregate[0]).toBe(tie.legs[0].userGoals + tie.legs[1].userGoals);
          expect(tie.aggregate[1]).toBe(tie.legs[0].oppGoals + tie.legs[1].oppGoals);
        }
      }
      // outcome consistent with knockout progress
      const lost = c.knockout.find((t) => !t.won);
      if (c.outcome === "champion" || c.outcome === "unbeaten-champion" || c.outcome === "perfect-champion") {
        expect(lost).toBeUndefined();
        expect(c.knockout[c.knockout.length - 1].round).toBe("final");
      }
    }
  });

  it("knockout opponents respect their stage bands and escalate toward the final", () => {
    const byStage = new Map<string, number[]>();
    for (const s of ["esc1", "esc2", "esc3", "esc4", "esc5", "esc6", "esc7", "esc8", "esc9", "esc10"]) {
      const { payload } = autoDraft(s);
      const d = decodeSeed(encodeSeed(payload, index), index, SIM_VERSION);
      if (!d.ok) throw new Error(d.error);
      const c = simulateCampaign(d.payload, d.players, index);
      for (const tie of c.knockout) {
        byStage.set(tie.round, [...(byStage.get(tie.round) ?? []), tie.opponentStrength]);
        const band = STAGE_BANDS[tie.round as KnockoutTie["round"]];
        expect(tie.opponentStrength).toBeGreaterThanOrEqual(band.min - 6); // relaxed-draw tolerance
        expect(tie.opponentStrength).toBeLessThanOrEqual(band.max + 2);
      }
    }
    // averages must escalate wherever adjacent stages were both reached
    const order: Array<KnockoutTie["round"]> = ["playoff", "r16", "qf", "sf", "final"];
    const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    for (let i = 1; i < order.length; i++) {
      const prev = byStage.get(order[i - 1]);
      const cur = byStage.get(order[i]);
      if (!prev || !cur || prev.length < 2 || cur.length < 2) continue;
      expect(avg(cur)).toBeGreaterThanOrEqual(avg(prev) - 1);
    }
    expect(byStage.size).toBeGreaterThan(0); // at least one knockout reached across seeds
  });

  it("opponents never include the user's drafted club-seasons and never repeat a club", () => {
    for (const s of ["ex1", "ex2", "ex3", "ex4"]) {
      const { payload } = autoDraft(s);
      const d = decodeSeed(encodeSeed(payload, index), index, SIM_VERSION);
      if (!d.ok) throw new Error(d.error);
      const c = simulateCampaign(d.payload, d.players, index);
      const drafted = new Set(d.players.map((p) => p.clubSeasonId));
      const facedClubs = new Map<string, number>();
      const face = (csId: string) => {
        expect(drafted.has(csId)).toBe(false);
        const clubId = index.clubSeasonById.get(csId)?.clubId ?? csId;
        facedClubs.set(clubId, (facedClubs.get(clubId) ?? 0) + 1);
      };
      for (const m of c.leagueMatches) face(m.opponentClubSeasonId);
      for (const t of c.knockout) face(t.opponentClubSeasonId);
      for (const [, n] of facedClubs) expect(n).toBe(1);
    }
  });

  it("badges are consistent with the campaign", () => {
    const { payload } = autoDraft("badge-seed");
    const d = decodeSeed(encodeSeed(payload, index), index, SIM_VERSION);
    if (!d.ok) throw new Error(d.error);
    const c = simulateCampaign(d.payload, d.players, index);
    const badges = detectBadges(c, d.players, index);
    expect(Array.isArray(badges)).toBe(true);
    const champion = ["champion", "unbeaten-champion", "perfect-champion"].includes(c.outcome);
    if (badges.some((b) => b.id === "champion" || b.id === "unbeaten" || b.id === "perfect")) {
      expect(champion).toBe(true);
    }
  });
});

describe("head-to-head", () => {
  it("reconstructs both seeds and battles deterministically in every mode", () => {
    const a = autoDraft("h2h-A");
    const b = autoDraft("h2h-B", "352");
    const seedA = encodeSeed(a.payload, index);
    const seedB = encodeSeed(b.payload, index);
    const decA = decodeSeed(seedA, index, SIM_VERSION);
    const decB = decodeSeed(seedB, index, SIM_VERSION);
    expect(decA.ok && decB.ok).toBe(true);
    if (!decA.ok || !decB.ok) return;
    for (const mode of ["final", "two-legged", "best-of-7"] as const) {
      const sideA = buildSide("Alpha XI", decA.payload, decA.players, index);
      const sideB = buildSide("Beta XI", decB.payload, decB.players, index);
      const r1 = simulateH2h(sideA, sideB, mode);
      const r2 = simulateH2h(sideA, sideB, mode);
      expect(JSON.stringify(r1)).toEqual(JSON.stringify(r2));
      expect([0, 1]).toContain(r1.winner);
      if (mode === "best-of-7") {
        expect(Math.max(r1.aggregate[0], r1.aggregate[1])).toBe(4);
        expect(r1.legs.length).toBeGreaterThanOrEqual(4);
        expect(r1.legs.length).toBeLessThanOrEqual(7);
      }
      if (mode === "two-legged") {
        expect(r1.legs).toHaveLength(2);
      }
    }
  });
});
