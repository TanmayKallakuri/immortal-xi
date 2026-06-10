import { beforeAll, describe, expect, it } from "vitest";
import { loadGameData, type GameDataIndex } from "../lib/data/game-data";
import { visibilityFor } from "../lib/draft/visibility";
import { buildRevealPlan, canSelectDuringReveal, skipReveal, REVEAL_DEFAULT_MS } from "../lib/draft/reveal";
import { newDraft, spin } from "../lib/draft/engine";
import { encodeSeed, decodeSeed } from "../lib/draft/seed";
import { SIM_VERSION } from "../lib/simulation/version";
import { autoDraft } from "./draft.test";

let index: GameDataIndex;

beforeAll(async () => {
  index = await loadGameData();
});

describe("mode visibility rules", () => {
  it("CLASSIC hides team finish during the draft but shows ratings/stats", () => {
    const v = visibilityFor("classic", "draft");
    expect(v.teamFinish).toBe(false);
    expect(v.ratings).toBe(true);
    expect(v.stats).toBe(true);
    expect(v.identity).toBe(true);
  });

  it("HARD hides team finish, ratings, stats, role, captain and confidence during the draft", () => {
    const v = visibilityFor("hard", "draft");
    expect(v.teamFinish).toBe(false);
    expect(v.ratings).toBe(false);
    expect(v.stats).toBe(false);
    expect(v.role).toBe(false);
    expect(v.captain).toBe(false);
    expect(v.confidence).toBe(false);
    expect(v.identity).toBe(true);
  });

  it("everything is revealed after the draft in both modes", () => {
    for (const mode of ["classic", "hard"] as const) {
      for (const phase of ["review", "result"] as const) {
        const v = visibilityFor(mode, phase);
        expect(v.teamFinish).toBe(true);
        expect(v.ratings).toBe(true);
        expect(v.stats).toBe(true);
      }
    }
  });

  it("mode does not change the spin sequence (same key, same teams)", () => {
    const classic = spin(newDraft("modespin", "433", "classic"), index);
    const hard = spin(newDraft("modespin", "433", "hard"), index);
    expect(classic.clubSeason.id).toEqual(hard.clubSeason.id);
  });
});

describe("mode in seeds", () => {
  it("hard mode round-trips through the compact seed payload", () => {
    const { payload } = autoDraft("hard-roundtrip", "433", "hard");
    expect(payload.mode).toBe("hard");
    const seed = encodeSeed(payload, index);
    const decoded = decodeSeed(seed, index, SIM_VERSION);
    expect(decoded.ok).toBe(true);
    if (decoded.ok) expect(decoded.payload.mode).toBe("hard");
  });

  it("classic and hard seeds for the same XI are distinct strings", () => {
    const a = autoDraft("samexikey", "433", "classic");
    const b = autoDraft("samexikey", "433", "hard");
    expect(a.payload.playerSeasonIds).toEqual(b.payload.playerSeasonIds); // spins identical
    expect(encodeSeed(a.payload, index)).not.toEqual(encodeSeed(b.payload, index));
  });
});

describe("spin reveal", () => {
  it("same seed/round produces the same reveal plan; final never changes", () => {
    const pool = ["A · 1960", "B · 1970", "C · 1980", "D · 1990"];
    const p1 = buildRevealPlan("k|r0", pool, "FINAL · 2000", false);
    const p2 = buildRevealPlan("k|r0", pool, "FINAL · 2000", false);
    expect(p1).toEqual(p2);
    expect(p1.decoys).not.toContain("FINAL · 2000");
    expect(p1.durationMs).toBe(REVEAL_DEFAULT_MS);
    expect(p1.durationMs).toBeGreaterThanOrEqual(900);
    expect(p1.durationMs).toBeLessThanOrEqual(1600);
  });

  it("the revealed club-season is decided before the animation (engine-level)", () => {
    // spin() result is independent of any reveal parameters
    const s1 = spin(newDraft("reveal-det", "352"), index);
    const s2 = spin(newDraft("reveal-det", "352"), index);
    expect(s1.clubSeason.id).toEqual(s2.clubSeason.id);
  });

  it("selection is gated until the reveal completes; skip unlocks it", () => {
    expect(canSelectDuringReveal("revealing")).toBe(false);
    expect(canSelectDuringReveal("revealed")).toBe(true);
    expect(canSelectDuringReveal(skipReveal())).toBe(true);
  });

  it("reduced motion bypasses the animation entirely", () => {
    const plan = buildRevealPlan("k|r1", ["A", "B"], "F", true);
    expect(plan.durationMs).toBe(0);
    expect(plan.decoys).toEqual([]);
  });
});
