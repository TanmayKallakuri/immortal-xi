/**
 * Pipeline database schema (SQLite locally; types kept Postgres-compatible).
 *
 * Three layers:
 *  - RAW:        sources, source_records          (never overwritten, append-only)
 *  - CANONICAL:  clubs, players, seasons, ...     (derived, deduped, provenance-carrying)
 *  - GAME:       exported separately to public/game-data.json by scripts/export
 *
 * draft_seeds / h2h_battles exist so that self-hosted deployments can log
 * shared seeds server-side; the static deployment keeps seeds client-side
 * (they are fully self-contained and reproducible).
 */
import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";

// ---------- RAW LAYER ----------

export const sources = sqliteTable("sources", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  url: text("url").notNull(),
  dataType: text("data_type").notNull(),
  parser: text("parser").notNull(),
  parserVersion: text("parser_version").notNull(),
  confidenceLevel: text("confidence_level").notNull(), // high | medium | low
  licenseNote: text("license_note").notNull(),
  redistributable: integer("redistributable", { mode: "boolean" }).notNull(),
  internalDerivationOnly: integer("internal_derivation_only", { mode: "boolean" }).notNull(),
  status: text("status").notNull(), // ok | blocked | registered
  statusNote: text("status_note").notNull().default(""),
  retrievedAt: text("retrieved_at"),
});

export const sourceRecords = sqliteTable("source_records", {
  id: text("id").primaryKey(),
  sourceId: text("source_id").notNull(),
  recordKey: text("record_key").notNull(), // e.g. page title
  url: text("url").notNull(),
  retrievedAt: text("retrieved_at").notNull(),
  parserVersion: text("parser_version").notNull(),
  rawPath: text("raw_path").notNull(), // file under data/raw/ holding the payload
  contentHash: text("content_hash").notNull(),
});

// ---------- CANONICAL LAYER ----------

export const competitions = sqliteTable("competitions", {
  id: text("id").primaryKey(), // "EC" | "UCL"
  name: text("name").notNull(),
  firstSeason: text("first_season"),
  lastSeason: text("last_season"),
});

export const seasons = sqliteTable("seasons", {
  id: text("id").primaryKey(), // "1955-56"
  competitionId: text("competition_id").notNull(),
  endYear: integer("end_year").notNull(),
  finalVenue: text("final_venue"),
  finalAttendance: integer("final_attendance"),
  sourceRecordId: text("source_record_id"),
  confidenceScore: real("confidence_score").notNull().default(1),
  needsReview: integer("needs_review", { mode: "boolean" }).notNull().default(false),
});

export const rounds = sqliteTable("rounds", {
  id: text("id").primaryKey(), // "1959-60:final"
  seasonId: text("season_id").notNull(),
  name: text("name").notNull(), // final | semi-final | ...
  ordinal: integer("ordinal").notNull(),
});

export const clubs = sqliteTable("clubs", {
  id: text("id").primaryKey(), // "real-madrid"
  name: text("name").notNull(),
  country: text("country"),
  matchedVia: text("matched_via").notNull(), // alias-map | fallback
});

export const clubAliases = sqliteTable("club_aliases", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  clubId: text("club_id").notNull(),
  alias: text("alias").notNull(),
  sourceRecordId: text("source_record_id"),
});

export const clubSeasons = sqliteTable("club_seasons", {
  id: text("id").primaryKey(), // "cs-real-madrid-1959-60"
  clubId: text("club_id").notNull(),
  seasonId: text("season_id").notNull(),
  progression: text("progression").notNull(), // W | RU
  finalScore: text("final_score"),
  squadComplete: integer("squad_complete", { mode: "boolean" }).notNull().default(false),
  starterCount: integer("starter_count").notNull().default(0),
  playerCount: integer("player_count").notNull().default(0),
  hasGoalkeeper: integer("has_goalkeeper", { mode: "boolean" }).notNull().default(false),
  confidenceScore: real("confidence_score").notNull().default(0),
  confidenceLabel: text("confidence_label").notNull().default("low"),
  needsReview: integer("needs_review", { mode: "boolean" }).notNull().default(false),
  reviewReason: text("review_reason"),
  sourceRecordId: text("source_record_id"),
});

export const players = sqliteTable("players", {
  id: text("id").primaryKey(), // "p-ferenc-puskas"
  name: text("name").notNull(),
  nationality: text("nationality"),
  identityEvidence: text("identity_evidence").notNull(), // wikilink | name-only
  wikiTitle: text("wiki_title"),
});

export const playerAliases = sqliteTable("player_aliases", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  playerId: text("player_id").notNull(),
  alias: text("alias").notNull(),
  sourceRecordId: text("source_record_id"),
});

export const playerSeasons = sqliteTable("player_seasons", {
  id: text("id").primaryKey(), // "ps-<player>-<endYear>"
  playerId: text("player_id").notNull(),
  clubSeasonId: text("club_season_id").notNull(),
  pos: text("pos").notNull(),
  posGroup: text("pos_group").notNull(), // GK | DF | MF | FW
  posInferred: integer("pos_inferred", { mode: "boolean" }).notNull().default(false),
  shirt: integer("shirt"),
  nationality: text("nationality"),
  captain: integer("captain", { mode: "boolean" }).notNull().default(false),
  role: text("role").notNull(), // starter | sub | bench
  finalGoals: integer("final_goals").notNull().default(0),
  confidenceScore: real("confidence_score").notNull().default(0),
  confidenceLabel: text("confidence_label").notNull().default("low"),
  needsReview: integer("needs_review", { mode: "boolean" }).notNull().default(false),
  reviewReason: text("review_reason"),
  sourceRecordId: text("source_record_id"),
});

/** squad membership rows (one per player per club-season, from lineup evidence) */
export const squads = sqliteTable("squads", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  clubSeasonId: text("club_season_id").notNull(),
  playerSeasonId: text("player_season_id").notNull(),
});

export const matches = sqliteTable("matches", {
  id: text("id").primaryKey(), // "m-1959-60-final"
  roundId: text("round_id").notNull(),
  seasonId: text("season_id").notNull(),
  date: text("date"),
  homeClubSeasonId: text("home_club_season_id").notNull(),
  awayClubSeasonId: text("away_club_season_id").notNull(),
  homeGoals: integer("home_goals").notNull(),
  awayGoals: integer("away_goals").notNull(),
  extraTime: integer("extra_time", { mode: "boolean" }).notNull().default(false),
  penalties: text("penalties"), // "5-4" or null
  venue: text("venue"),
  sourceRecordId: text("source_record_id"),
});

export const appearances = sqliteTable("appearances", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  matchId: text("match_id").notNull(),
  playerSeasonId: text("player_season_id").notNull(),
  started: integer("started", { mode: "boolean" }).notNull(),
  cameOn: integer("came_on", { mode: "boolean" }).notNull().default(false),
  minuteOn: integer("minute_on"),
  minuteOff: integer("minute_off"),
});

export const goals = sqliteTable("goals", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  matchId: text("match_id").notNull(),
  playerSeasonId: text("player_season_id"),
  scorerName: text("scorer_name").notNull(),
  minute: text("minute"),
  penalty: integer("penalty", { mode: "boolean" }).notNull().default(false),
  ownGoal: integer("own_goal", { mode: "boolean" }).notNull().default(false),
  forClubSeasonId: text("for_club_season_id").notNull(),
});

export const positionsRef = sqliteTable("positions", {
  code: text("code").primaryKey(),
  groupCode: text("group_code").notNull(),
  label: text("label").notNull(),
});

export const ratings = sqliteTable("ratings", {
  playerSeasonId: text("player_season_id").primaryKey(),
  overall: real("overall").notNull(),
  attack: real("attack").notNull(),
  control: real("control").notNull(),
  defense: real("defense").notNull(),
  physical: real("physical").notNull(),
  goalkeeping: real("goalkeeping").notNull(),
  clutch: real("clutch").notNull(),
  uclAura: real("ucl_aura").notNull(),
  rarity: real("rarity").notNull(),
  formulaVersion: text("formula_version").notNull(),
  overrideApplied: integer("override_applied", { mode: "boolean" }).notNull().default(false),
  explanation: text("explanation").notNull(), // JSON of weighted inputs
});

export const dataQualityFlags = sqliteTable("data_quality_flags", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  flagType: text("flag_type").notNull(),
  severity: text("severity").notNull(), // info | warn | error
  detail: text("detail").notNull(),
  createdAt: text("created_at").notNull(),
});

export const manualOverrides = sqliteTable("manual_overrides", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  fieldsChanged: text("fields_changed").notNull(), // JSON
  reason: text("reason").notNull(),
  authorNote: text("author_note").notNull(),
  date: text("date").notNull(),
});

export const simulationVersions = sqliteTable("simulation_versions", {
  version: text("version").primaryKey(),
  notes: text("notes").notNull(),
  createdAt: text("created_at").notNull(),
});

// ---------- RUNTIME-LOG LAYER (optional server-side persistence) ----------

export const draftSeeds = sqliteTable("draft_seeds", {
  seed: text("seed").primaryKey(),
  dataVersion: text("data_version").notNull(),
  simVersion: text("sim_version").notNull(),
  formation: text("formation").notNull(),
  outcome: text("outcome"),
  createdAt: text("created_at").notNull(),
});

export const h2hBattles = sqliteTable("h2h_battles", {
  id: text("id").primaryKey(),
  seedA: text("seed_a").notNull(),
  seedB: text("seed_b").notNull(),
  mode: text("mode").notNull(),
  simVersion: text("sim_version").notNull(),
  winner: text("winner"),
  createdAt: text("created_at").notNull(),
});
