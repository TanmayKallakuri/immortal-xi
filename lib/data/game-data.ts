/** Game-data access: typed loading + index maps over public/game-data.json. */
import type { GameClubSeason, GameData, GamePlayerSeason } from "../types";
import { z } from "zod";

const ratingsSchema = z.object({
  overall: z.number(), attack: z.number(), control: z.number(), defense: z.number(),
  physical: z.number(), goalkeeping: z.number(), clutch: z.number(), uclAura: z.number(),
  rarity: z.number(),
});

const gameDataSchema = z.object({
  dataVersion: z.string(),
  generatedAt: z.string(),
  clubSeasons: z.array(
    z.object({
      id: z.string(), clubId: z.string(), clubName: z.string(), country: z.string().nullable(),
      season: z.string(), year: z.number(), eraLabel: z.string(),
      competition: z.enum(["EC", "UCL"]),
      progression: z.string(), category: z.string(), tags: z.array(z.string()),
      finalScore: z.string(), opponentClubName: z.string(),
      teamStrength: z.number(),
      confidence: z.object({ score: z.number(), label: z.enum(["high", "medium", "low"]) }),
      flags: z.array(z.string()), playerSeasonIds: z.array(z.string()),
    }),
  ),
  playerSeasons: z.array(
    z.object({
      id: z.string(), playerId: z.string(), name: z.string(), clubSeasonId: z.string(),
      pos: z.string(), posGroup: z.enum(["GK", "DF", "MF", "FW"]),
      shirt: z.number().nullable(), nationality: z.string().nullable(),
      captain: z.boolean(), role: z.enum(["starter", "sub", "bench", "squad"]),
      finalGoals: z.number(), seasonApps: z.number().nullable(), seasonGoals: z.number().nullable(),
      careerFinals: z.number(), careerFinalWins: z.number(),
      ratings: ratingsSchema,
      confidence: z.object({ score: z.number(), label: z.enum(["high", "medium", "low"]) }),
      flags: z.array(z.string()), overrideApplied: z.boolean(),
    }),
  ),
  sources: z.array(z.unknown()),
  quality: z.unknown(),
});

export interface GameDataIndex {
  data: GameData;
  clubSeasonById: Map<string, GameClubSeason>;
  playerSeasonById: Map<string, GamePlayerSeason>;
  /** position of each player-season in the exported array (used by seeds) */
  playerSeasonIndexById: Map<string, number>;
  draftable: GameClubSeason[];
  /** finalist seasons per clubId (for cult/superclub weighting) */
  finalistSeasonsByClub: Map<string, number>;
}

export function indexGameData(raw: unknown): GameDataIndex {
  const parsed = gameDataSchema.parse(raw) as unknown as GameData;
  const clubSeasonById = new Map(parsed.clubSeasons.map((c) => [c.id, c]));
  const playerSeasonById = new Map(parsed.playerSeasons.map((p) => [p.id, p]));
  const playerSeasonIndexById = new Map(parsed.playerSeasons.map((p, i) => [p.id, i]));
  const draftable = parsed.clubSeasons.filter((c) => c.playerSeasonIds.length >= 11);
  const finalistSeasonsByClub = new Map<string, number>();
  for (const cs of draftable) {
    finalistSeasonsByClub.set(cs.clubId, (finalistSeasonsByClub.get(cs.clubId) ?? 0) + 1);
  }
  return { data: parsed, clubSeasonById, playerSeasonById, playerSeasonIndexById, draftable, finalistSeasonsByClub };
}

let cached: GameDataIndex | null = null;

/** Browser: fetch from /game-data.json. Node (tests/scripts): read from disk. */
export async function loadGameData(): Promise<GameDataIndex> {
  if (cached) return cached;
  if (typeof window === "undefined") {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const raw = JSON.parse(readFileSync(join(process.cwd(), "public", "game-data.json"), "utf8"));
    cached = indexGameData(raw);
  } else {
    const res = await fetch("/game-data.json");
    if (!res.ok) throw new Error("failed to load game data");
    cached = indexGameData(await res.json());
  }
  return cached;
}
