/**
 * Live-clock reveal over a precomputed deterministic match.
 *
 * The engine still computes the whole match up front (same seed => same
 * events); these pure helpers control what the UI is ALLOWED to show at a
 * given clock state, so the final score can never leak before full time.
 * Penalties reveal kick by kick after the 120' clock.
 */
import type { MatchEvent, MatchResult, PenaltyKick } from "./engine";

export type LiveSpeed = "slow" | "normal" | "fast" | "instant";

/** ms of real time per simulated minute */
export const SPEED_MS: Record<LiveSpeed, number> = {
  slow: 600,
  normal: 250,
  fast: 80,
  instant: 0,
};

/** ms between revealed penalty kicks */
export const PEN_KICK_MS: Record<LiveSpeed, number> = {
  slow: 2200,
  normal: 1400,
  fast: 500,
  instant: 0,
};

export interface LiveState {
  /** simulated clock minute, 0..fullTime */
  minute: number;
  /** penalty kicks revealed so far (only meaningful once clock is done) */
  kicksRevealed: number;
}

export function hasExtraTime(result: MatchResult): boolean {
  return result.etGoals !== null;
}

/** the minute at which this match's clock ends (90 or 120) */
export function fullTimeMinute(result: MatchResult): number {
  return hasExtraTime(result) ? 120 : 90;
}

export function clockDone(state: LiveState, result: MatchResult): boolean {
  return state.minute >= fullTimeMinute(result);
}

/** everything — clock AND shootout — fully revealed */
export function matchDone(state: LiveState, result: MatchResult): boolean {
  if (!clockDone(state, result)) return false;
  const kicks = result.penKicks?.length ?? 0;
  return state.kicksRevealed >= kicks;
}

/** advance one tick: a minute while the clock runs, then one kick at a time */
export function advance(state: LiveState, result: MatchResult): LiveState {
  if (!clockDone(state, result)) {
    return { ...state, minute: state.minute + 1 };
  }
  const kicks = result.penKicks?.length ?? 0;
  return { ...state, kicksRevealed: Math.min(kicks, state.kicksRevealed + 1) };
}

export function skipToEnd(result: MatchResult): LiveState {
  return { minute: fullTimeMinute(result), kicksRevealed: result.penKicks?.length ?? 0 };
}

/** events the UI may show at this clock state (never future ones) */
export function visibleEvents(state: LiveState, result: MatchResult): MatchEvent[] {
  return result.events.filter((e) => {
    if (e.minute > state.minute) return false;
    // the shootout-summary drama line waits until every kick is revealed
    if (e.type === "drama" && e.text.startsWith("Penalties:") && !matchDone(state, result)) return false;
    return true;
  });
}

export function visibleKicks(state: LiveState, result: MatchResult): PenaltyKick[] {
  if (!clockDone(state, result)) return [];
  return (result.penKicks ?? []).slice(0, state.kicksRevealed);
}

/** running score from REVEALED goal events only — the live scoreboard */
export function liveScore(state: LiveState, result: MatchResult): [number, number] {
  let a = 0;
  let b = 0;
  for (const e of visibleEvents(state, result)) {
    if (e.type === "goal" || e.type === "penalty-goal") {
      if (e.side === 0) a++;
      else b++;
    }
  }
  return [a, b];
}

/** running shootout score from revealed kicks */
export function livePenScore(state: LiveState, result: MatchResult): [number, number] {
  let a = 0;
  let b = 0;
  for (const k of visibleKicks(state, result)) {
    if (k.scored) {
      if (k.side === 0) a++;
      else b++;
    }
  }
  return [a, b];
}

export function phaseLabel(state: LiveState, result: MatchResult): string {
  if (matchDone(state, result)) {
    return result.penKicks ? "FT (pens)" : hasExtraTime(result) ? "FT (aet)" : "FT";
  }
  if (clockDone(state, result)) return "Penalties";
  if (state.minute >= 105 && hasExtraTime(result)) return "ET 2nd half";
  if (state.minute > 90) return "Extra time";
  if (state.minute === 45) return "HT";
  if (state.minute >= 46 && state.minute < 90) return "2nd half";
  return state.minute === 0 ? "Kick-off" : "1st half";
}
