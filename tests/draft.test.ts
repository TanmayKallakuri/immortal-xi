import { beforeAll, describe, expect, it } from "vitest";
import { loadGameData, type GameDataIndex } from "../lib/data/game-data";
import { newDraft, spin, applyPick, spinWeight, type DraftState, type DraftMode, MAX_SAME_CLUB } from "../lib/draft/engine";
import { encodeSeed, decodeSeed, type SeedPayload } from "../lib/draft/seed";
import { formationById } from "../lib/draft/formations";
import { SIM_VERSION } from "../lib/simulation/version";

let index: GameDataIndex;

beforeAll(async () => {
  index = await loadGameData();
});

/** play a full deterministic draft: always pick the best-rated selectable player */
export function autoDraft(
  seed: string,
  formationId = "433",
  mode: DraftMode = "classic",
): { state: DraftState; payload: SeedPayload } {
  let state = newDraft(seed, formationId, mode);
  while (state.round < 11) {
    const s = spin(state, index);
    const selectable = s.selectable
      .filter((p) => !p.blockedReason)
      .sort((a, b) => b.player.ratings.overall - a.player.ratings.overall || a.player.id.localeCompare(b.player.id));
    // prefer filling GK when offered, otherwise highest-rated with best fit
    const open = selectable.find((p) => p.eligibleSlots.some((e) => e.slot.group === p.player.posGroup)) ?? selectable[0];
    const slot =
      open.eligibleSlots.slice().sort((a, b) => b.fit - a.fit || a.slot.id.localeCompare(b.slot.id))[0].slot;
    state = applyPick(state, s.clubSeason, open.player.id, slot.id, index);
  }
  const formation = formationById(formationId)!;
  const bySlot = new Map(state.picks.map((p) => [p.slotId, p.playerSeasonId]));
  const payload: SeedPayload = {
    dataVersion: index.data.dataVersion,
    simVersion: SIM_VERSION,
    mode,
    formationId,
    draftSeed: seed,
    playerSeasonIds: formation.slots.map((s) => bySlot.get(s.id)!),
  };
  return { state, payload };
}

describe("draft engine", () => {
  it("same seed + same picks produce the same spin sequence", () => {
    const a = autoDraft("det-seed-1");
    const b = autoDraft("det-seed-1");
    expect(a.state.spunClubSeasonIds).toEqual(b.state.spunClubSeasonIds);
    expect(a.state.picks).toEqual(b.state.picks);
  });

  it("different seeds branch", () => {
    const a = autoDraft("seed-A");
    const b = autoDraft("seed-B");
    expect(a.state.spunClubSeasonIds).not.toEqual(b.state.spunClubSeasonIds);
  });

  it("never spins the same exact club-season twice", () => {
    for (const seed of ["x1", "x2", "x3", "x4", "x5"]) {
      const { state } = autoDraft(seed);
      expect(new Set(state.spunClubSeasonIds).size).toBe(state.spunClubSeasonIds.length);
    }
  });

  it("never picks the same player twice", () => {
    for (const seed of ["y1", "y2", "y3"]) {
      const { state } = autoDraft(seed);
      expect(new Set(state.picks.map((p) => p.playerId)).size).toBe(11);
    }
  });

  it("caps a club at two seasons per draft", () => {
    for (const seed of ["z1", "z2", "z3", "z4", "z5", "z6"]) {
      const { state } = autoDraft(seed);
      const byClub = new Map<string, Set<string>>();
      for (const p of state.picks) {
        byClub.set(p.clubId, (byClub.get(p.clubId) ?? new Set()).add(p.clubSeasonId));
      }
      for (const seasons of byClub.values()) {
        expect(seasons.size).toBeLessThanOrEqual(MAX_SAME_CLUB);
      }
    }
  });

  it("applies the repeat-club penalty deterministically", () => {
    let state = newDraft("penalty-test", "433");
    const real = index.draftable.filter((c) => c.clubId === "real-madrid");
    expect(real.length).toBeGreaterThan(2);
    const before = spinWeight(real[0], state, index);
    // simulate having picked from another Real Madrid season
    const other = real[1];
    const ps = index.playerSeasonById.get(other.playerSeasonIds[0])!;
    state = {
      ...state,
      picks: [{ slotId: "GK", playerSeasonId: ps.id, playerId: ps.playerId, clubSeasonId: other.id, clubId: other.clubId }],
      spunClubSeasonIds: [other.id],
      round: 1,
    };
    const after = spinWeight(real[0], state, index);
    expect(after.weight).toBeGreaterThan(0);
    expect(after.parts.clubDiversity).toBeLessThan(before.parts.clubDiversity);
    expect(after.parts.clubDiversity).toBeCloseTo(0.22);
  });

  it("weights include band/category diversity and only mild champion bias", () => {
    const state = newDraft("diversity-parts", "433");
    const champion = index.draftable.find((c) => c.category === "champion")!;
    const semi = index.draftable.find((c) => c.category === "semi_finalist")!;
    const wChampion = spinWeight(champion, state, index);
    const wSemi = spinWeight(semi, state, index);
    expect(wChampion.parts.significance).toBeCloseTo(1.05);
    expect(wSemi.parts.significance).toBeCloseTo(1.0);
    expect(wChampion.parts.bandDiversity).toBeDefined();
    expect(wChampion.parts.categoryDiversity).toBeDefined();
  });

  it("drafts pull in non-finalist iconic teams across seeds (power-curve diversity)", () => {
    const categories = new Set<string>();
    for (const seed of ["div1", "div2", "div3", "div4", "div5", "div6", "div7", "div8"]) {
      const { state } = autoDraft(seed);
      for (const csId of state.spunClubSeasonIds) {
        categories.add(index.clubSeasonById.get(csId)!.category);
      }
    }
    // across 8 drafts the archive must surface beyond champions/runners-up
    expect([...categories].some((c) => !["champion", "runner_up"].includes(c))).toBe(true);
    expect(categories.size).toBeGreaterThanOrEqual(3);
  });

  it("rejects invalid picks", () => {
    const state = newDraft("invalid-test", "433");
    const s = spin(state, index);
    const gkPlayer = s.selectable.find((p) => p.player.posGroup === "GK" && !p.blockedReason);
    if (gkPlayer) {
      expect(() => applyPick(state, s.clubSeason, gkPlayer.player.id, "ST", index)).toThrow();
    }
    const outfield = s.selectable.find((p) => p.player.posGroup === "FW" && !p.blockedReason)!;
    expect(() => applyPick(state, s.clubSeason, outfield.player.id, "GK", index)).toThrow();
  });
});

describe("share seeds", () => {
  it("round-trips exactly", () => {
    const { payload } = autoDraft("roundtrip");
    const seed = encodeSeed(payload, index);
    const decoded = decodeSeed(seed, index, SIM_VERSION);
    expect(decoded.ok).toBe(true);
    if (decoded.ok) {
      expect(decoded.payload).toEqual(payload);
      expect(decoded.players.map((p) => p.id)).toEqual(payload.playerSeasonIds);
    }
  });

  it("rejects tampered seeds via checksum", () => {
    const { payload } = autoDraft("tamper");
    const seed = encodeSeed(payload, index);
    const parts = seed.split(".");
    parts[4] = parts[4] === "evil" ? "evil2" : "evil";
    const bad = decodeSeed(parts.join("."), index, SIM_VERSION);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toMatch(/checksum/i);
  });

  it("rejects wrong simulation versions clearly", () => {
    const { payload } = autoDraft("simver");
    const seed = encodeSeed(payload, index);
    const res = decodeSeed(seed, index, "99.0.0");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/simulation/i);
  });

  it("rejects garbage", () => {
    expect(decodeSeed("not-a-seed", index, SIM_VERSION).ok).toBe(false);
    expect(decodeSeed("IX1.a.b.c.d.e.f.g.h", index, SIM_VERSION).ok).toBe(false);
  });
});
