import { beforeAll, describe, expect, it } from "vitest";
import { loadGameData, type GameDataIndex } from "../lib/data/game-data";
import {
  formationById,
  slotFit,
  slotFitForPositions,
  canonicalPosCode,
  ineligibleReason,
} from "../lib/draft/formations";
import { newDraft, spin, applyPick } from "../lib/draft/engine";

let index: GameDataIndex;
beforeAll(async () => {
  index = await loadGameData();
});

const f433 = () => formationById("433")!;
const slot = (fid: string, id: string) => formationById(fid)!.slots.find((s) => s.id === id)!;

describe("strict cross-line blocking", () => {
  it("CB/SW/CH/generic-DF cannot fit central midfield (Upamecano case)", () => {
    for (const code of ["CB", "SW", "CH", "DF"]) {
      expect(slotFit(code, "DF", slot("433", "CM2"))).toBe(0);
      expect(slotFit(code, "DF", slot("4231", "DM1"))).toBe(0);
    }
  });

  it("CM/MF/DM cannot fit centre back", () => {
    for (const code of ["CM", "MF", "DM", "RH", "LH"]) {
      expect(slotFit(code, "MF", slot("433", "CB1"))).toBe(0);
    }
  });

  it("AM/CAM/SS cannot fit ANY defender slot (Olmo/Charlton case)", () => {
    for (const code of ["AM", "CAM", "SS"]) {
      for (const s of f433().slots.filter((x) => x.group === "DF")) {
        expect(slotFit(code, "MF", s)).toBe(0);
        expect(slotFit(code, "FW", s)).toBe(0);
      }
    }
  });

  it("forwards and wingers cannot fit central midfield", () => {
    for (const code of ["CF", "ST", "RW", "LW", "OR", "OL", "RF", "LF", "FW"]) {
      expect(slotFit(code, "FW", slot("433", "CM1"))).toBe(0);
    }
  });

  it("DM cannot fit CB unless an explicit secondary CB exists", () => {
    const cb = slot("433", "CB1");
    expect(slotFit("DM", "MF", cb)).toBe(0);
    expect(slotFitForPositions(["DM", "CB"], "MF", cb)).toBeGreaterThan(0); // explicit data only
  });

  it("group fallbacks never invent cross-line eligibility", () => {
    expect(slotFit("??", "DF", slot("433", "CM1"))).toBe(0);
    expect(slotFit("??", "MF", slot("433", "CB1"))).toBe(0);
    expect(slotFit("??", "FW", slot("433", "CB1"))).toBe(0);
  });
});

describe("plausible adjacent roles keep penalties", () => {
  it("RF / Right Forward fits RW naturally (George Best case)", () => {
    expect(slotFit("RF", "FW", slot("433", "RW"))).toBe(1);
    expect(canonicalPosCode("Right Forward")).toBe("RF");
    expect(slotFit(canonicalPosCode("Right Forward"), "FW", slot("433", "RW"))).toBe(1);
  });

  it("inside-forward aliases map to central attacking roles", () => {
    expect(canonicalPosCode("Inside Right")).toBe("IR");
    expect(slotFit("RI", "FW", slot("433", "ST"))).toBeGreaterThan(0.9);
    expect(slotFit("LI", "FW", slot("433", "CB1"))).toBe(0);
  });

  it("winger drops to wide midfield with a penalty, never centrally", () => {
    const rm = slot("442", "RM");
    const fit = slotFit("RW", "FW", rm);
    expect(fit).toBeGreaterThan(0);
    expect(fit).toBeLessThan(1);
  });

  it("fullback/wingback fits wide defence naturally and wide midfield with penalty", () => {
    expect(slotFit("RB", "DF", slot("433", "RB"))).toBe(1);
    expect(slotFit("RB", "DF", slot("532", "RWB"))).toBe(1); // RB at RWB allowed
    const wideMid = slotFit("RWB", "DF", slot("442", "RM"));
    expect(wideMid).toBeGreaterThan(0);
    expect(wideMid).toBeLessThan(1);
  });

  it("CAM can support the attack (ST/SS) with penalty, ST can go wide with penalty", () => {
    const camAtSt = slotFit("CAM", "MF", slot("433", "ST"));
    expect(camAtSt).toBeGreaterThan(0);
    expect(camAtSt).toBeLessThan(1);
    const stWide = slotFit("ST", "FW", slot("433", "LW"));
    expect(stWide).toBeGreaterThan(0);
    expect(stWide).toBeLessThan(1);
  });

  it("blocked players still get clear reasons", () => {
    const onlyMid = f433().slots.filter((s) => s.group === "MF");
    expect(ineligibleReason("CB", "DF", onlyMid)).toBe("Defensive slots full");
    expect(ineligibleReason(["CB"], "DF", onlyMid)).toBe("Defensive slots full");
  });
});

describe("completed XIs are football-plausible", () => {
  it("every pick across seeds lands in an eligible, same-or-adjacent role", () => {
    for (const seedKey of ["plaus1", "plaus2", "plaus3"]) {
      for (const fid of ["433", "532"]) {
        let state = newDraft(seedKey, fid);
        while (state.round < 11) {
          const s = spin(state, index);
          const pick = s.selectable
            .filter((p) => !p.blockedReason)
            .sort((a, b) => a.player.id.localeCompare(b.player.id))[0];
          const sl = pick.eligibleSlots.sort((a, b) => b.fit - a.fit || a.slot.id.localeCompare(b.slot.id))[0].slot;
          state = applyPick(state, s.clubSeason, pick.player.id, sl.id, index);
        }
        const formation = formationById(fid)!;
        for (const p of state.picks) {
          const player = index.playerSeasonById.get(p.playerSeasonId)!;
          const sl = formation.slots.find((x) => x.id === p.slotId)!;
          const fit = slotFitForPositions(player.positions, player.posGroup, sl);
          expect(fit).toBeGreaterThan(0);
          // no cross-line placements survive: outfield players never sit
          // more than one line from a sourced position
          if (sl.group === "DF") expect(player.posGroup === "DF" || player.positions.some((c) => slotFit(c, player.posGroup, sl) > 0)).toBe(true);
        }
      }
    }
  });
});
