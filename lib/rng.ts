/**
 * Deterministic seeded RNG.
 *
 * xmur3 string hash -> mulberry32 PRNG. Both are well-known public-domain
 * algorithms. Everything in the game that needs randomness (draft spins,
 * match simulation, opponent draws) flows through this module so that the
 * same seed string always produces the same sequence on every platform.
 */

export type Rng = {
  /** float in [0, 1) */
  next(): number;
  /** integer in [min, max] inclusive */
  int(min: number, max: number): number;
  /** pick one element */
  pick<T>(arr: readonly T[]): T;
  /** weighted pick; weights must be >= 0 and not all zero */
  weighted<T>(items: readonly T[], weights: readonly number[]): T;
  /** Fisher-Yates shuffle (returns a new array) */
  shuffle<T>(arr: readonly T[]): T[];
  /** approximately normal (mean 0, sd 1) via sum of uniforms */
  gauss(): number;
  /** fork a derived, independent stream */
  fork(label: string): Rng;
};

function xmur3(str: string): () => number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return function () {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^= h >>> 16) >>> 0;
  };
}

function mulberry32(a: number): () => number {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createRng(seed: string): Rng {
  const seedFn = xmur3(seed);
  const rand = mulberry32(seedFn());

  const rng: Rng = {
    next: () => rand(),
    int(min, max) {
      return Math.floor(rand() * (max - min + 1)) + min;
    },
    pick(arr) {
      if (arr.length === 0) throw new Error("rng.pick on empty array");
      return arr[Math.floor(rand() * arr.length)];
    },
    weighted(items, weights) {
      if (items.length !== weights.length || items.length === 0) {
        throw new Error("rng.weighted: bad inputs");
      }
      let total = 0;
      for (const w of weights) {
        if (w < 0 || !Number.isFinite(w)) throw new Error("rng.weighted: negative/invalid weight");
        total += w;
      }
      if (total <= 0) throw new Error("rng.weighted: all-zero weights");
      let r = rand() * total;
      for (let i = 0; i < items.length; i++) {
        r -= weights[i];
        if (r < 0) return items[i];
      }
      return items[items.length - 1];
    },
    shuffle(arr) {
      const out = arr.slice();
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
      }
      return out;
    },
    gauss() {
      // Irwin-Hall approximation: sum of 12 uniforms - 6 ~ N(0,1)
      let s = 0;
      for (let i = 0; i < 12; i++) s += rand();
      return s - 6;
    },
    fork(label) {
      return createRng(seed + "::" + label);
    },
  };
  return rng;
}

/** Stable 32-bit hash of a string, as unsigned int. Used for checksums. */
export function hash32(str: string): number {
  return xmur3(str)();
}

/** Stable short base36 fingerprint of arbitrary content. */
export function fingerprint(str: string): string {
  const f = xmur3(str);
  const a = f();
  const b = f();
  return (a.toString(36) + b.toString(36)).slice(0, 10);
}
