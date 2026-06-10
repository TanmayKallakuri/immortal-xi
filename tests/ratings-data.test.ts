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

  it("no non-override squad/bench player reaches 86+ overall anywhere in the export", () => {
    const offenders = index.data.playerSeasons.filter(
      (p) => (p.role === "squad" || p.role === "bench") && !p.overrideApplied && p.ratings.overall >= 86,
    );
    expect(offenders.map((o) => o.id)).toEqual([]);
  });

  it("within every club-season, no same-role same-apps-tier defender outranks a goal-scoring attacker", () => {
    const violations: string[] = [];
    const goalsOf = (p: { finalGoals: number; seasonGoals: number | null }) => p.finalGoals + (p.seasonGoals ?? 0);
    const appsTier = (p: { seasonApps: number | null }) =>
      p.seasonApps === null ? 0 : p.seasonApps >= 8 ? 2 : p.seasonApps >= 4 ? 1 : p.seasonApps <= 1 ? -1 : 0;
    for (const cs of index.draftable) {
      const squad = cs.playerSeasonIds.map((id) => index.playerSeasonById.get(id)!).filter(Boolean);
      const scorers = squad.filter((p) => p.posGroup !== "GK" && p.posGroup !== "DF" && goalsOf(p) > 0 && !p.overrideApplied);
      const defenders = squad.filter((p) => p.posGroup === "DF" && goalsOf(p) === 0 && !p.overrideApplied);
      for (const s of scorers) {
        for (const d of defenders) {
          if (d.role === s.role && appsTier(d) <= appsTier(s) && d.ratings.overall > s.ratings.overall) {
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
});
