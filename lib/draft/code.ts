/**
 * Compact share codes: 6-7 character handles over full seeds.
 *
 * A full seed cannot fit in 7 characters, so the compact code is a SLUG that
 * points to the full saved payload in a registry (localStorage on the static
 * deployment; the Registry interface accepts any backing store, so a hosted
 * build can plug a database in without touching callers).
 *
 * Alphabet: 23456789ABCDEFGHJKLMNPQRSTUVWXYZ (no 0/O, 1/I/l, no punctuation).
 * Codes derive deterministically from the seed content; collisions extend
 * the code with salted characters until a free slot is found.
 *
 * Cross-device honesty: a localStorage code resolves only on the device that
 * saved it. The full seed remains the portable fallback and is embedded in
 * share text. This limitation is documented on /about.
 */
import { hash32 } from "../rng";

export const CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
export const CODE_LENGTH = 6;
export const CODE_MAX_LENGTH = 8;

export interface CodeRegistry {
  get(code: string): string | null;
  set(code: string, seed: string): void;
}

/** hash -> base-32-safe string of the requested length */
function hashToCode(input: string, length: number): string {
  let out = "";
  let h = hash32(input);
  for (let i = 0; i < length; i++) {
    if (i > 0 && i % 6 === 0) h = hash32(input + "#" + i); // refresh entropy
    out += CODE_ALPHABET[h % 32];
    h = Math.floor(h / 32) ^ hash32(input + ":" + i);
    h = Math.abs(h);
  }
  return out;
}

export function isCompactCode(s: string): boolean {
  const t = s.trim().toUpperCase();
  if (t.length < CODE_LENGTH || t.length > CODE_MAX_LENGTH) return false;
  return [...t].every((c) => CODE_ALPHABET.includes(c));
}

export function normalizeCode(s: string): string {
  return s.trim().toUpperCase();
}

/**
 * Save a seed and return its compact code. Deterministic per seed; collision
 * with a DIFFERENT seed extends/salts the code (bounded attempts).
 */
export function saveSeed(seed: string, registry: CodeRegistry): string {
  for (let attempt = 0; attempt < 32; attempt++) {
    const length = attempt < 8 ? CODE_LENGTH : attempt < 20 ? 7 : CODE_MAX_LENGTH;
    const code = hashToCode(attempt === 0 ? seed : `${seed}|salt${attempt}`, length);
    const existing = registry.get(code);
    if (existing === null) {
      registry.set(code, seed);
      return code;
    }
    if (existing === seed) return code; // same XI, same code
  }
  throw new Error("could not allocate a share code (registry full?)");
}

export function resolveCode(code: string, registry: CodeRegistry): string | null {
  if (!isCompactCode(code)) return null;
  return registry.get(normalizeCode(code));
}

// ---------------------------------------------------------------------------

const LS_PREFIX = "ix-code:";

export function localStorageRegistry(): CodeRegistry {
  return {
    get(code) {
      try {
        return window.localStorage.getItem(LS_PREFIX + normalizeCode(code));
      } catch {
        return null;
      }
    },
    set(code, seed) {
      try {
        window.localStorage.setItem(LS_PREFIX + normalizeCode(code), seed);
      } catch {
        /* storage full/blocked: code sharing degrades to full seeds */
      }
    },
  };
}

export function memoryRegistry(): CodeRegistry {
  const store = new Map<string, string>();
  return {
    get: (code) => store.get(normalizeCode(code)) ?? null,
    set: (code, seed) => void store.set(normalizeCode(code), seed),
  };
}

/** Accept either a compact code (resolved via registry) or a full seed. */
export function resolveSeedInput(input: string, registry: CodeRegistry): { seed: string | null; viaCode: boolean; error?: string } {
  const t = input.trim();
  if (!t) return { seed: null, viaCode: false };
  if (isCompactCode(t)) {
    const seed = resolveCode(t, registry);
    if (!seed) {
      return {
        seed: null,
        viaCode: true,
        error: `Code ${normalizeCode(t)} not found on this device — paste the full seed instead (codes are stored locally).`,
      };
    }
    return { seed, viaCode: true };
  }
  return { seed: t, viaCode: false };
}
