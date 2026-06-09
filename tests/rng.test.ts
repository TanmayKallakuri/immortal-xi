import { describe, expect, it } from "vitest";
import { createRng, fingerprint, hash32 } from "../lib/rng";

describe("rng", () => {
  it("is deterministic for the same seed", () => {
    const a = createRng("hello");
    const b = createRng("hello");
    const seqA = Array.from({ length: 50 }, () => a.next());
    const seqB = Array.from({ length: 50 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });

  it("differs across seeds", () => {
    expect(createRng("a").next()).not.toEqual(createRng("b").next());
  });

  it("int stays within bounds", () => {
    const rng = createRng("bounds");
    for (let i = 0; i < 1000; i++) {
      const v = rng.int(3, 7);
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThanOrEqual(7);
    }
  });

  it("weighted respects zero weights", () => {
    const rng = createRng("w");
    for (let i = 0; i < 200; i++) {
      expect(rng.weighted(["a", "b"], [0, 1])).toBe("b");
    }
    expect(() => rng.weighted(["a"], [0])).toThrow();
    expect(() => rng.weighted(["a"], [-1])).toThrow();
  });

  it("fork produces independent deterministic streams", () => {
    const x = createRng("base").fork("draw").next();
    const y = createRng("base").fork("draw").next();
    const z = createRng("base").fork("other").next();
    expect(x).toEqual(y);
    expect(x).not.toEqual(z);
  });

  it("hash32/fingerprint are stable", () => {
    expect(hash32("stable")).toEqual(hash32("stable"));
    expect(fingerprint("abc")).toEqual(fingerprint("abc"));
    expect(fingerprint("abc")).not.toEqual(fingerprint("abd"));
  });
});
