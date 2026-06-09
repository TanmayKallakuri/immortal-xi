/**
 * Deterministic draft engine.
 *
 * Each round spins one real club-season via weighted randomness. The RNG
 * stream for a round is derived from (draft seed, round number, every prior
 * spin and pick), so the same seed + same choices always reproduce the same
 * sequence, while different choices branch the timeline deterministically.
 *
 * Weight inputs (docs/DECISIONS.md):
 *   data confidence, squad completeness, historical significance (W vs RU),
 *   era coverage vs already-drafted decades, club diversity (repeat-club
 *   penalty), cult-team bonus, superclub damping, strength-band mixing.
 */
import { createRng } from "../rng";
import type { GameDataIndex } from "../data/game-data";
import type { GameClubSeason, GamePlayerSeason } from "../types";
import { formationById, positionFit, type Formation, type FormationSlot } from "./formations";

export interface DraftPick {
  slotId: string;
  playerSeasonId: string;
  playerId: string;
  clubSeasonId: string;
  clubId: string;
}

export interface DraftState {
  draftSeed: string;
  formationId: string;
  round: number; // 0-based; round === 11 means draft complete
  picks: DraftPick[];
  spunClubSeasonIds: string[]; // every club-season already spun this draft
}

export function newDraft(draftSeed: string, formationId: string): DraftState {
  if (!formationById(formationId)) throw new Error(`unknown formation ${formationId}`);
  return { draftSeed, formationId, round: 0, picks: [], spunClubSeasonIds: [] };
}

export const REPEAT_CLUB_PENALTY = 0.22;
export const MAX_SAME_CLUB = 2;

export interface SpinResult {
  clubSeason: GameClubSeason;
  /** squad members the user may actually select right now */
  selectable: SelectablePlayer[];
  weightExplanation: Record<string, number>;
}

export interface SelectablePlayer {
  player: GamePlayerSeason;
  eligibleSlots: Array<{ slot: FormationSlot; fit: number }>;
  blockedReason: string | null; // e.g. "already in your XI"
}

export function openSlots(state: DraftState, formation: Formation): FormationSlot[] {
  const filled = new Set(state.picks.map((p) => p.slotId));
  return formation.slots.filter((s) => !filled.has(s.id));
}

function clubCount(state: DraftState, clubId: string): number {
  return new Set(state.picks.filter((p) => p.clubId === clubId).map((p) => p.clubSeasonId)).size;
}

export function selectablePlayers(
  cs: GameClubSeason,
  state: DraftState,
  index: GameDataIndex,
): SelectablePlayer[] {
  const formation = formationById(state.formationId)!;
  const open = openSlots(state, formation);
  const usedPlayerIds = new Set(state.picks.map((p) => p.playerId));
  return cs.playerSeasonIds
    .map((id) => index.playerSeasonById.get(id)!)
    .filter(Boolean)
    .map((player) => {
      const eligibleSlots = open
        .map((slot) => ({ slot, fit: positionFit(player.posGroup, slot) }))
        .filter((e) => e.fit > 0);
      const blockedReason = usedPlayerIds.has(player.playerId)
        ? "already in your XI"
        : eligibleSlots.length === 0
          ? "no compatible open position"
          : null;
      return { player, eligibleSlots, blockedReason };
    });
}

/** Weight of a club-season for the current round (0 = excluded). */
export function spinWeight(
  cs: GameClubSeason,
  state: DraftState,
  index: GameDataIndex,
): { weight: number; parts: Record<string, number> } {
  const parts: Record<string, number> = {};
  if (state.spunClubSeasonIds.includes(cs.id)) return { weight: 0, parts: { alreadySpun: 0 } };

  const repeats = clubCount(state, cs.clubId);
  if (repeats >= MAX_SAME_CLUB) return { weight: 0, parts: { clubCap: 0 } };

  // must offer at least one selectable player
  const anySelectable = selectablePlayers(cs, state, index).some((p) => !p.blockedReason);
  if (!anySelectable) return { weight: 0, parts: { noSelectablePlayer: 0 } };

  const confidence = cs.confidence.score; // 0.55 - 0.92
  parts.confidence = confidence;
  const completeness = Math.min(1, cs.playerSeasonIds.length / 16);
  parts.completeness = 0.7 + 0.3 * completeness;
  const significance = cs.progression === "W" ? 1.15 : 1.0;
  parts.significance = significance;

  const pickedDecades = new Set(
    state.picks.map((p) => index.clubSeasonById.get(p.clubSeasonId)?.eraLabel ?? ""),
  );
  const eraBoost = pickedDecades.has(cs.eraLabel) ? 0.8 : 1.5;
  parts.eraCoverage = eraBoost;

  const clubDiversity = repeats === 0 ? 1 : REPEAT_CLUB_PENALTY;
  parts.clubDiversity = clubDiversity;

  const clubFinals = index.finalistSeasonsByClub.get(cs.clubId) ?? 1;
  const cult = clubFinals <= 2 ? 1.25 : 1;
  parts.cultBonus = cult;
  const superclubDamp = clubFinals >= 10 ? 0.75 : 1;
  parts.superclubDamp = superclubDamp;

  const weight =
    confidence * parts.completeness * significance * eraBoost * clubDiversity * cult * superclubDamp;
  return { weight, parts };
}

/** Deterministic spin for the current round. Does not mutate state. */
export function spin(state: DraftState, index: GameDataIndex): SpinResult {
  if (state.round >= 11) throw new Error("draft already complete");
  const rng = createRng(
    [
      "spin",
      state.draftSeed,
      state.formationId,
      `r${state.round}`,
      state.picks.map((p) => p.playerSeasonId).join(","),
      state.spunClubSeasonIds.join(","),
    ].join("|"),
  );
  const candidates: GameClubSeason[] = [];
  const weights: number[] = [];
  const explanations: Array<Record<string, number>> = [];
  for (const cs of index.draftable) {
    const { weight, parts } = spinWeight(cs, state, index);
    if (weight > 0) {
      candidates.push(cs);
      weights.push(weight);
      explanations.push(parts);
    }
  }
  if (candidates.length === 0) throw new Error("no spinnable club-seasons left");
  const picked = rng.weighted(candidates, weights);
  const i = candidates.indexOf(picked);
  return {
    clubSeason: picked,
    selectable: selectablePlayers(picked, state, index),
    weightExplanation: explanations[i],
  };
}

/** Apply a player pick; returns the next state. Throws on invalid picks. */
export function applyPick(
  state: DraftState,
  spun: GameClubSeason,
  playerSeasonId: string,
  slotId: string,
  index: GameDataIndex,
): DraftState {
  const formation = formationById(state.formationId)!;
  const slot = formation.slots.find((s) => s.id === slotId);
  if (!slot) throw new Error(`unknown slot ${slotId}`);
  if (state.picks.some((p) => p.slotId === slotId)) throw new Error(`slot ${slotId} already filled`);
  if (!spun.playerSeasonIds.includes(playerSeasonId)) throw new Error("player is not in the spun squad");
  const player = index.playerSeasonById.get(playerSeasonId);
  if (!player) throw new Error("unknown player-season");
  if (state.picks.some((p) => p.playerId === player.playerId)) {
    throw new Error(`${player.name} is already in your XI`);
  }
  if (positionFit(player.posGroup, slot) <= 0) {
    throw new Error(`${player.name} (${player.posGroup}) cannot play ${slot.label}`);
  }
  return {
    ...state,
    round: state.round + 1,
    picks: [
      ...state.picks,
      {
        slotId,
        playerSeasonId,
        playerId: player.playerId,
        clubSeasonId: spun.id,
        clubId: spun.clubId,
      },
    ],
    spunClubSeasonIds: [...state.spunClubSeasonIds, spun.id],
  };
}
