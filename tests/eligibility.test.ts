import { beforeAll, describe, expect, it } from "vitest";
import { loadGameData, type GameDataIndex } from "../lib/data/game-data";
import { FORMATIONS, formationById, slotFit, ineligibleReason, slotClassOf } from "../lib/draft/formations";
import { newDraft, spin, applyPick, selectablePlayers, openSlots, type DraftState } from "../lib/draft/engine";
import type { GamePlayerSeason } from "../lib/types";

let index: GameDataIndex;

beforeAll(async () => {
  index = await loadGameData();
});

const f433 = () => formationById("433")!;

function mockState(formationId: string, picks: DraftState["picks"]): DraftState {
  return { draftSeed: "elig", formationId, mode: "classic", round: picks.length, picks, spunClubSeasonIds: [] };
}

/** fabricate a pick occupying a slot (engine state only; ids are real) */
function occupy(slotId: string, n: number): DraftState["picks"][number] {
  const ps = index.data.playerSeasons[n];
  return { slotId, playerSeasonId: ps.id, playerId: ps.playerId, clubSeasonId: ps.clubSeasonId, clubId: "x" + n };
}

describe("slot fits", () => {
  it("GK is hard-gated both ways", () => {
    const gkSlot = f433().slots.find((s) => s.group === "GK")!;
    const stSlot = f433().slots.find((s) => s.id === "ST")!;
    expect(slotFit("GK", "GK", gkSlot)).toBe(1);
    expect(slotFit("GK", "GK", stSlot)).toBe(0);
    expect(slotFit("CF", "FW", gkSlot)).toBe(0);
  });

  it("ST-only codes do not fit midfield or defense", () => {
    for (const slot of f433().slots.filter((s) => s.group === "MF" || s.group === "DF")) {
      expect(slotFit("ST", "FW", slot)).toBe(0);
      expect(slotFit("CF", "FW", slot)).toBe(0);
    }
  });

  it("a winger fits wide forward AND wide midfield slots", () => {
    const f442 = formationById("442")!;
    const lm = f442.slots.find((s) => s.id === "LM")!;
    const rw = f433().slots.find((s) => s.id === "RW")!;
    expect(slotFit("LW", "FW", lm)).toBeGreaterThan(0);
    expect(slotFit("OL", "FW", rw)).toBeGreaterThan(0);
  });

  it("centre backs cannot play as forwards", () => {
    for (const slot of f433().slots.filter((s) => s.group === "FW")) {
      expect(slotFit("CB", "DF", slot)).toBe(0);
    }
  });

  it("every formation slot classifies", () => {
    for (const f of FORMATIONS) {
      for (const slot of f.slots) {
        expect(["GK", "DF_C", "DF_W", "MF_C", "MF_W", "FW_C", "FW_W"]).toContain(slotClassOf(slot));
      }
    }
  });
});

describe("ineligible reasons", () => {
  const formation = f433();
  it("GK-only players are disabled with the goalkeeper reason once GK is filled", () => {
    const open = formation.slots.filter((s) => s.id !== "GK");
    expect(ineligibleReason("GK", "GK", open)).toBe("Goalkeeper already selected");
    expect(ineligibleReason("GK", "GK", formation.slots)).toBeNull();
  });

  it("ST-only players are disabled with the forward reason when FW slots are full", () => {
    const open = formation.slots.filter((s) => s.group !== "FW" && s.group !== "GK");
    expect(ineligibleReason("ST", "FW", open)).toBe("Forward slots full");
    expect(ineligibleReason("CF", "FW", open)).toBe("Forward slots full");
  });

  it("multi-position players stay selectable while any compatible slot is open", () => {
    // winger: FW slots full but LM open in 4-4-2
    const f442 = formationById("442")!;
    const open = f442.slots.filter((s) => s.group === "MF");
    expect(ineligibleReason("LW", "FW", open)).toBeNull();
    // pure striker in the same situation is blocked
    expect(ineligibleReason("ST", "FW", open)).toBe("Forward slots full");
  });

  it("defense-only players get the defensive reason", () => {
    const open = f433().slots.filter((s) => s.group === "FW");
    expect(ineligibleReason("CB", "DF", open)).not.toBeNull();
  });
});

describe("draft-time eligibility", () => {
  it("disabled players cannot be selected via applyPick (no UI bypass)", () => {
    const formation = f433();
    // fill GK with a real GK pick from a fresh spin
    let state = newDraft("bypass-test", "433");
    let guard = 0;
    let gkPlayer: GamePlayerSeason | null = null;
    let spunCs = null as ReturnType<typeof spin> | null;
    while (!gkPlayer && guard++ < 30) {
      const s = spin(state, index);
      const gk = s.selectable.find((p) => p.player.posGroup === "GK" && !p.blockedReason);
      if (gk) {
        gkPlayer = gk.player;
        spunCs = s;
        state = applyPick(state, s.clubSeason, gk.player.id, "GK", index);
      } else {
        const any = s.selectable.find((p) => !p.blockedReason)!;
        const slot = any.eligibleSlots[0].slot;
        state = applyPick(state, s.clubSeason, any.player.id, slot.id, index);
      }
    }
    expect(gkPlayer).not.toBeNull();
    // now any further GK is blocked AND applyPick refuses outfield placement
    const s2 = spin(state, index);
    const blockedGk = s2.selectable.find((p) => p.player.posGroup === "GK");
    if (blockedGk) {
      expect(blockedGk.blockedReason).toBe("Goalkeeper already selected");
      for (const slot of openSlots(state, formation)) {
        expect(() => applyPick(state, s2.clubSeason, blockedGk.player.id, slot.id, index)).toThrow();
      }
    }
    void spunCs;
  });

  it("spins never land on a club-season with zero selectable players", () => {
    for (const seedKey of ["dead1", "dead2", "dead3"]) {
      let state = newDraft(seedKey, "532"); // defense-heavy: stresses FW availability
      while (state.round < 11) {
        const s = spin(state, index);
        const pickable = s.selectable.filter((p) => !p.blockedReason);
        expect(pickable.length).toBeGreaterThan(0);
        const choice = pickable.sort((a, b) => a.player.id.localeCompare(b.player.id))[0];
        const slot = choice.eligibleSlots.sort((a, b) => b.fit - a.fit || a.slot.id.localeCompare(b.slot.id))[0].slot;
        state = applyPick(state, s.clubSeason, choice.player.id, slot.id, index);
      }
      // completed XI fits the formation: every slot filled exactly once, valid fits
      const formation = formationById("532")!;
      const slotIds = new Set(state.picks.map((p) => p.slotId));
      expect(slotIds.size).toBe(11);
      for (const pick of state.picks) {
        const player = index.playerSeasonById.get(pick.playerSeasonId)!;
        const slot = formation.slots.find((s) => s.id === pick.slotId)!;
        expect(slotFit(player.pos, player.posGroup, slot)).toBeGreaterThan(0);
      }
    }
  });

  it("blocked players expose user-facing reasons", () => {
    // construct a state where forwards are full
    const formation = f433();
    const fwSlots = formation.slots.filter((s) => s.group === "FW").map((s) => s.id);
    const gkSlot = "GK";
    const picks = [...fwSlots, gkSlot].map((slotId, i) => occupy(slotId, i * 17));
    const state = mockState("433", picks);
    const anyFinalist = index.draftable.find((cs) =>
      cs.playerSeasonIds.some((id) => {
        const p = index.playerSeasonById.get(id)!;
        return (p.pos === "CF" || p.pos === "ST") && p.posGroup === "FW";
      }),
    )!;
    const sel = selectablePlayers(anyFinalist, state, index);
    const striker = sel.find((p) => (p.player.pos === "CF" || p.player.pos === "ST") && p.blockedReason);
    expect(striker?.blockedReason).toBe("Forward slots full");
  });
});
