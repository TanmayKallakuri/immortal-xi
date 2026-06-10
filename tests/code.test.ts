import { beforeAll, describe, expect, it } from "vitest";
import { loadGameData, type GameDataIndex } from "../lib/data/game-data";
import {
  saveSeed,
  resolveCode,
  resolveSeedInput,
  isCompactCode,
  memoryRegistry,
  CODE_ALPHABET,
  CODE_LENGTH,
} from "../lib/draft/code";
import { decodeSeed, encodeSeed } from "../lib/draft/seed";
import { buildSide, simulateH2h } from "../lib/simulation/h2h";
import { SIM_VERSION } from "../lib/simulation/version";
import { autoDraft } from "./draft.test";

let index: GameDataIndex;

beforeAll(async () => {
  index = await loadGameData();
});

describe("compact share codes", () => {
  it("generates a 6-char code from the safe alphabet", () => {
    const reg = memoryRegistry();
    const code = saveSeed("IX2.test.seed.payload", reg);
    expect(code).toHaveLength(CODE_LENGTH);
    for (const c of code) expect(CODE_ALPHABET).toContain(c);
    // no confusable characters by construction
    expect(code).not.toMatch(/[01OIl]/);
  });

  it("is deterministic per seed and idempotent", () => {
    const reg = memoryRegistry();
    const c1 = saveSeed("seed-A", reg);
    const c2 = saveSeed("seed-A", reg);
    expect(c1).toEqual(c2);
  });

  it("validates and resolves codes case-insensitively", () => {
    const reg = memoryRegistry();
    const code = saveSeed("seed-B", reg);
    expect(isCompactCode(code)).toBe(true);
    expect(resolveCode(code.toLowerCase(), reg)).toBe("seed-B");
    expect(isCompactCode("ix2.not.a.code")).toBe(false);
    expect(isCompactCode("AB")).toBe(false);
    expect(resolveCode("ZZZZZZ", reg)).toBeNull();
  });

  it("handles collisions by salting to a different code", () => {
    const reg = memoryRegistry();
    const codeA = saveSeed("collide-A", reg);
    // force a collision: another seed pre-registered at A's code
    const reg2 = memoryRegistry();
    reg2.set(codeA, "someone-else");
    const codeB = saveSeed("collide-A", reg2);
    expect(codeB).not.toEqual(codeA);
    expect(resolveCode(codeB, reg2)).toBe("collide-A");
    expect(resolveCode(codeA, reg2)).toBe("someone-else"); // untouched
  });

  it("reconstructs the exact XI through code -> seed -> decode", () => {
    const reg = memoryRegistry();
    const { payload } = autoDraft("code-roundtrip", "4231", "hard");
    const seed = encodeSeed(payload, index);
    const code = saveSeed(seed, reg);
    const resolved = resolveCode(code, reg);
    expect(resolved).toBe(seed);
    const decoded = decodeSeed(resolved!, index, SIM_VERSION);
    expect(decoded.ok).toBe(true);
    if (decoded.ok) {
      expect(decoded.payload).toEqual(payload);
      expect(decoded.payload.mode).toBe("hard");
    }
  });

  it("gives a useful error for unknown codes and accepts full seeds as fallback", () => {
    const reg = memoryRegistry();
    const unknown = resolveSeedInput("XXXXXX", reg);
    expect(unknown.seed).toBeNull();
    expect(unknown.error).toMatch(/not found on this device/i);

    const { payload } = autoDraft("fallback-input");
    const seed = encodeSeed(payload, index);
    const viaSeed = resolveSeedInput(seed, reg);
    expect(viaSeed.seed).toBe(seed);
    expect(viaSeed.viaCode).toBe(false);
  });

  it("H2H runs off two compact codes", () => {
    const reg = memoryRegistry();
    const a = autoDraft("h2h-code-A");
    const b = autoDraft("h2h-code-B", "352");
    const codeA = saveSeed(encodeSeed(a.payload, index), reg);
    const codeB = saveSeed(encodeSeed(b.payload, index), reg);
    const seedA = resolveSeedInput(codeA, reg).seed!;
    const seedB = resolveSeedInput(codeB, reg).seed!;
    const decA = decodeSeed(seedA, index, SIM_VERSION);
    const decB = decodeSeed(seedB, index, SIM_VERSION);
    expect(decA.ok && decB.ok).toBe(true);
    if (!decA.ok || !decB.ok) return;
    const r1 = simulateH2h(buildSide("Alpha XI", decA.payload, decA.players, index), buildSide("Beta XI", decB.payload, decB.players, index), "two-legged");
    const r2 = simulateH2h(buildSide("Alpha XI", decA.payload, decA.players, index), buildSide("Beta XI", decB.payload, decB.players, index), "two-legged");
    expect(JSON.stringify(r1)).toEqual(JSON.stringify(r2));
    expect([0, 1]).toContain(r1.winner);
  });
});
