/**
 * Share seeds: a completed XI encoded as a portable, checksummed string.
 *
 * Format v2 (dot-separated):
 *   IX2.<dataVersion>.<simVersion>.<mode>.<formationId>.<draftSeed>.<picks>.<crc>
 *
 * mode = "c" (classic) | "h" (hard) — preserved through reconstruction.
 * picks = slot-ordered base36 indexes into the exported playerSeasons array,
 * joined by "-". The crc (hash32 of everything before it, base36) rejects
 * corrupted/edited seeds; dataVersion / simVersion reject seeds from
 * incompatible builds with a clear message instead of wrong results.
 *
 * For the user-facing 6-7 character code layered on top, see lib/draft/code.ts.
 */
import { z } from "zod";
import { hash32 } from "../rng";
import { formationById } from "./formations";
import type { DraftMode } from "./engine";
import type { GameDataIndex } from "../data/game-data";
import type { GamePlayerSeason } from "../types";

export const SEED_PREFIX = "IX2";

export interface SeedPayload {
  dataVersion: string;
  simVersion: string;
  mode: DraftMode;
  formationId: string;
  draftSeed: string;
  /** player-season ids in formation slot order */
  playerSeasonIds: string[];
}

const seedPayloadSchema = z.object({
  dataVersion: z.string().min(1),
  simVersion: z.string().min(1),
  mode: z.enum(["classic", "hard"]),
  formationId: z.string().min(1),
  draftSeed: z.string().min(1).max(64),
  playerSeasonIds: z.array(z.string()).length(11),
});

const sanitize = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64) || "seed";

const MODE_CODE: Record<DraftMode, string> = { classic: "c", hard: "h" };
const MODE_FROM_CODE: Record<string, DraftMode> = { c: "classic", h: "hard" };

export function encodeSeed(payload: SeedPayload, index: GameDataIndex): string {
  seedPayloadSchema.parse(payload);
  if (payload.simVersion.includes("_")) {
    throw new Error("SIM_VERSION must not contain underscores (reserved as the seed dot-escape)");
  }
  const picks = payload.playerSeasonIds
    .map((id) => {
      const i = index.playerSeasonIndexById.get(id);
      if (i === undefined) throw new Error(`unknown player-season in seed: ${id}`);
      return i.toString(36);
    })
    .join("-");
  const sv = payload.simVersion.replace(/\./g, "_");
  const body = [
    SEED_PREFIX,
    payload.dataVersion,
    sv,
    MODE_CODE[payload.mode],
    payload.formationId,
    sanitize(payload.draftSeed),
    picks,
  ].join(".");
  const crc = hash32(body).toString(36);
  return `${body}.${crc}`;
}

export type SeedDecodeResult =
  | { ok: true; payload: SeedPayload; players: GamePlayerSeason[] }
  | { ok: false; error: string };

export function decodeSeed(seed: string, index: GameDataIndex, expectedSimVersion: string): SeedDecodeResult {
  const trimmed = seed.trim();
  const parts = trimmed.split(".");
  if (parts[0] === "IX1") {
    return { ok: false, error: "This seed is from the v1 data era and cannot be reconstructed by this build." };
  }
  if (parts.length !== 8) return { ok: false, error: "Malformed seed: wrong number of segments." };
  const [prefix, dataVersion, svRaw, modeRaw, formationId, draftSeed, picksRaw, crc] = parts;
  if (prefix !== SEED_PREFIX) return { ok: false, error: `Unknown seed format "${prefix}" (expected ${SEED_PREFIX}).` };
  const body = parts.slice(0, 7).join(".");
  if (hash32(body).toString(36) !== crc) return { ok: false, error: "Checksum mismatch: seed is corrupted or was edited." };
  const simVersion = svRaw.replace(/_/g, ".");
  if (dataVersion !== index.data.dataVersion) {
    return { ok: false, error: `Seed was created with data version ${dataVersion}; this build runs ${index.data.dataVersion}.` };
  }
  if (simVersion !== expectedSimVersion) {
    return { ok: false, error: `Seed was created with simulation ${simVersion}; this build runs ${expectedSimVersion}.` };
  }
  const mode = MODE_FROM_CODE[modeRaw];
  if (!mode) return { ok: false, error: `Unknown mode "${modeRaw}".` };
  const formation = formationById(formationId);
  if (!formation) return { ok: false, error: `Unknown formation "${formationId}".` };
  const idxs = picksRaw.split("-").map((x) => parseInt(x, 36));
  if (idxs.length !== 11 || idxs.some((n) => Number.isNaN(n))) {
    return { ok: false, error: "Malformed picks segment." };
  }
  const players: GamePlayerSeason[] = [];
  for (const i of idxs) {
    const ps = index.data.playerSeasons[i];
    if (!ps) return { ok: false, error: `Pick index ${i} not found in this data version.` };
    players.push(ps);
  }
  const ids = new Set(players.map((p) => p.playerId));
  if (ids.size !== 11) return { ok: false, error: "Seed contains the same player twice." };
  const gkIndex = formation.slots.findIndex((s) => s.group === "GK");
  if (gkIndex === -1) return { ok: false, error: `Formation "${formationId}" has no goalkeeper slot.` };
  if (players[gkIndex].posGroup !== "GK") return { ok: false, error: "Seed has no goalkeeper in goal." };

  const payload: SeedPayload = {
    dataVersion,
    simVersion,
    mode,
    formationId,
    draftSeed,
    playerSeasonIds: players.map((p) => p.id),
  };
  return { ok: true, payload, players };
}
