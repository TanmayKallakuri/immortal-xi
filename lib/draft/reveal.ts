/**
 * Spin reveal: the archive-flip animation state, as a pure deterministic
 * helper so the gating rules are testable without a browser.
 *
 * The final club-season is decided by the draft engine BEFORE the reveal
 * begins; decoy frames are cosmetic and never change the result. The user
 * cannot select a player until the reveal completes; clicking skips it;
 * reduced-motion bypasses it entirely.
 */
import { createRng } from "../rng";

export interface RevealPlan {
  /** decoy labels flipped through during the animation (final NOT included) */
  decoys: string[];
  /** total duration in ms (0 = instant reveal) */
  durationMs: number;
  /** per-frame interval */
  frameMs: number;
}

export const REVEAL_DEFAULT_MS = 1250; // within the 900-1600ms product window
export const REVEAL_FRAME_MS = 110;

/**
 * Build the deterministic reveal plan for a round.
 * @param seedKey unique per (draftSeed, round) — e.g. `${draftSeed}|r${round}`
 * @param decoyPool candidate labels (e.g. all draftable "Club Season" names)
 * @param finalLabel the actual result — excluded from decoys
 * @param reducedMotion bypass animation entirely
 */
export function buildRevealPlan(
  seedKey: string,
  decoyPool: string[],
  finalLabel: string,
  reducedMotion: boolean,
  durationMs: number = REVEAL_DEFAULT_MS,
): RevealPlan {
  if (reducedMotion) return { decoys: [], durationMs: 0, frameMs: REVEAL_FRAME_MS };
  const rng = createRng(`reveal|${seedKey}`);
  const frames = Math.max(3, Math.floor(durationMs / REVEAL_FRAME_MS));
  const pool = decoyPool.filter((d) => d !== finalLabel);
  const decoys: string[] = [];
  for (let i = 0; i < frames; i++) {
    decoys.push(pool.length ? pool[rng.int(0, pool.length - 1)] : "…");
  }
  return { decoys, durationMs, frameMs: REVEAL_FRAME_MS };
}

export type RevealPhase = "revealing" | "revealed";

/** Selection gate: players are selectable only after the reveal completes. */
export function canSelectDuringReveal(phase: RevealPhase): boolean {
  return phase === "revealed";
}

/** Skipping ends the animation; the final result is unchanged by definition
 *  because it was computed before the reveal began. */
export function skipReveal(): RevealPhase {
  return "revealed";
}
