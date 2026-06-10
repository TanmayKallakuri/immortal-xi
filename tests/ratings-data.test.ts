/**
 * Data-backed rating regression tests against the live export. These verify
 * the structural fixes on real records — not by special-casing players, but
 * by asserting the invariants the formula must produce on real data.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { loadGameData, type GameDataIndex } from "../lib/data/game-data";

let index: GameDataIndex;

beforeAll(async () => {
  index = await loadGameData();
});

const goalsOf = (p: { finalGoals: number; seasonGoals: number | null }) => p.finalGoals + (p.seasonGoals ?? 0);
const appsOf = (p: { seasonApps: number | null }) => p.seasonApps ?? 0;

describe("ratings on real data", () => {
  it("Bayern 2012/13: the decisive final scorer outranks the supporting fullback (regression)", () => {
    const robben = index.playerSeasonById.get("ps-arjen-robben-2013");
    const alaba = index.playerSeasonById.get("ps-david-alaba-2013");
    // only meaningful if both exist in the dataset (they do: 2013 final lineups)
    if (!robben || !alaba) return;
    expect(robben.finalGoals).toBeGreaterThan(0); // scored the 89' winner
    expect(robben.ratings.overall).toBeGreaterThan(alaba.ratings.overall);
    expect(alaba.ratings.overall).toBeLessThan(90);
  });

  it("no squad/bench player reaches 86+ without strong season evidence or an override", () => {
    const offenders = index.data.playerSeasons.filter(
      (p) =>
        (p.role === "squad" || p.role === "bench") &&
        !p.overrideApplied &&
        p.ratings.overall >= 86 &&
        !(goalsOf(p) >= 4 || appsOf(p) >= 8),
    );
    expect(offenders.map((o) => o.id)).toEqual([]);
  });

  it("within every club-season, no equal-or-less-involved defender outranks a meaningful scorer", () => {
    const violations: string[] = [];
    for (const cs of index.draftable) {
      const squad = cs.playerSeasonIds.map((id) => index.playerSeasonById.get(id)!).filter(Boolean);
      const scorers = squad.filter(
        (p) =>
          (p.posGroup === "FW" || p.posGroup === "MF") &&
          goalsOf(p) > 0 &&
          (p.finalGoals >= 1 || (p.seasonGoals ?? 0) >= 3) &&
          !p.overrideApplied,
      );
      const defenders = squad.filter((p) => p.posGroup === "DF" && goalsOf(p) === 0 && !p.overrideApplied);
      for (const s of scorers) {
        for (const d of defenders) {
          if (d.role === s.role && appsOf(d) <= appsOf(s) && d.ratings.overall > s.ratings.overall) {
            violations.push(`${d.name} > ${s.name} in ${cs.id}`);
          }
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("same player rates differently across seasons when evidence differs (real data)", () => {
    // any player with 2+ seasons and differing finalGoals must not share overall
    let checked = 0;
    const byPlayer = new Map<string, typeof index.data.playerSeasons>();
    for (const p of index.data.playerSeasons) {
      byPlayer.set(p.playerId, [...(byPlayer.get(p.playerId) ?? []), p]);
    }
    for (const seasons of byPlayer.values()) {
      if (seasons.length < 2) continue;
      for (let i = 0; i < seasons.length && checked < 50; i++) {
        for (let j = i + 1; j < seasons.length; j++) {
          const a = seasons[i];
          const b = seasons[j];
          if (a.overrideApplied || b.overrideApplied) continue;
          if (a.role !== b.role) continue;
          const sameTier = index.clubSeasonById.get(a.clubSeasonId)?.progression === index.clubSeasonById.get(b.clubSeasonId)?.progression;
          if (sameTier && a.finalGoals !== b.finalGoals) {
            expect(a.ratings.overall).not.toEqual(b.ratings.overall);
            checked++;
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  describe("Monaco 2016/17 (regression: the flat-77 squad)", () => {
    it("the squad spreads instead of clustering", () => {
      const monaco = index.clubSeasonById.get("cs-monaco-2016-17");
      if (!monaco) return; // dataset without the curated entry
      const squad = monaco.playerSeasonIds.map((id) => index.playerSeasonById.get(id)!).filter(Boolean);
      const overalls = squad.map((p) => p.ratings.overall);
      expect(Math.max(...overalls) - Math.min(...overalls)).toBeGreaterThanOrEqual(12);
      expect(new Set(overalls).size).toBeGreaterThanOrEqual(10);
    });

    it("Mbappé's breakout season rates in the star band, not at the squad base", () => {
      const mbappe = index.playerSeasonById.get("ps-kylian-mbappe-2017");
      if (!mbappe) return;
      expect(mbappe.ratings.overall).toBeGreaterThanOrEqual(82);
      expect(mbappe.ratings.overall).toBeLessThanOrEqual(88);
      expect(mbappe.ratings.attack).toBeGreaterThanOrEqual(90);
      expect(mbappe.overrideApplied).toBe(false); // the GLOBAL model produces this
    });

    it("Falcao separates from generic squad players; Glik reads as a starter, not a star", () => {
      const monaco = index.clubSeasonById.get("cs-monaco-2016-17");
      const falcao = index.playerSeasonById.get("ps-radamel-falcao-2017");
      const glik = index.playerSeasonById.get("ps-kamil-glik-2017");
      if (!monaco || !falcao || !glik) return;
      const squad = monaco.playerSeasonIds.map((id) => index.playerSeasonById.get(id)!).filter(Boolean);
      const sorted = squad.map((p) => p.ratings.overall).sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)];
      expect(falcao.ratings.overall).toBeGreaterThanOrEqual(84);
      expect(falcao.ratings.overall).toBeGreaterThan(median + 4);
      expect(glik.ratings.overall).toBeGreaterThanOrEqual(78);
      expect(glik.ratings.overall).toBeLessThan(falcao.ratings.overall - 4);
      expect(glik.ratings.defense).toBeGreaterThan(glik.ratings.attack); // position-specific
    });

    it("reserves and the backup keeper stay in the fringe band", () => {
      const monaco = index.clubSeasonById.get("cs-monaco-2016-17");
      if (!monaco) return;
      const squad = monaco.playerSeasonIds.map((id) => index.playerSeasonById.get(id)!).filter(Boolean);
      for (const p of squad) {
        if (p.seasonApps !== null && p.seasonApps <= 1 && goalsOf(p) === 0) {
          expect(p.ratings.overall).toBeLessThanOrEqual(74);
        }
      }
      const gks = squad.filter((p) => p.posGroup === "GK" && p.seasonApps !== null);
      const starter = gks.find((p) => appsOf(p) >= 8);
      const backup = gks.find((p) => appsOf(p) <= 2);
      if (starter && backup) {
        expect(starter.ratings.overall - backup.ratings.overall).toBeGreaterThanOrEqual(2);
      }
    });
  });
});
