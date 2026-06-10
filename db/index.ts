/**
 * SQLite connection + DDL bootstrap for pipeline scripts.
 *
 * Decision: schema DDL is generated at open-time from a hand-maintained SQL
 * block kept in lockstep with schema.ts (instead of drizzle-kit migrations)
 * because the pipeline DB is fully rebuildable from data/raw at any time —
 * `npm run clean` drops and recreates the canonical layer.
 */
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";
import path from "node:path";
import fs from "node:fs";

export const DB_PATH = path.join(process.cwd(), "data", "immortal.db");

const DDL = `
CREATE TABLE IF NOT EXISTS sources (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, url TEXT NOT NULL, data_type TEXT NOT NULL,
  parser TEXT NOT NULL, parser_version TEXT NOT NULL, confidence_level TEXT NOT NULL,
  license_note TEXT NOT NULL, redistributable INTEGER NOT NULL, internal_derivation_only INTEGER NOT NULL,
  status TEXT NOT NULL, status_note TEXT NOT NULL DEFAULT '', retrieved_at TEXT
);
CREATE TABLE IF NOT EXISTS source_records (
  id TEXT PRIMARY KEY, source_id TEXT NOT NULL, record_key TEXT NOT NULL, url TEXT NOT NULL,
  retrieved_at TEXT NOT NULL, parser_version TEXT NOT NULL, raw_path TEXT NOT NULL, content_hash TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS competitions (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, first_season TEXT, last_season TEXT
);
CREATE TABLE IF NOT EXISTS seasons (
  id TEXT PRIMARY KEY, competition_id TEXT NOT NULL, end_year INTEGER NOT NULL,
  final_venue TEXT, final_attendance INTEGER, source_record_id TEXT,
  confidence_score REAL NOT NULL DEFAULT 1, needs_review INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS rounds (
  id TEXT PRIMARY KEY, season_id TEXT NOT NULL, name TEXT NOT NULL, ordinal INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS clubs (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, country TEXT, matched_via TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS club_aliases (
  id INTEGER PRIMARY KEY AUTOINCREMENT, club_id TEXT NOT NULL, alias TEXT NOT NULL, source_record_id TEXT
);
CREATE TABLE IF NOT EXISTS club_seasons (
  id TEXT PRIMARY KEY, club_id TEXT NOT NULL, season_id TEXT NOT NULL, progression TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'participant', tags TEXT NOT NULL DEFAULT '[]',
  squad_completeness TEXT NOT NULL DEFAULT 'low_confidence',
  final_score TEXT, squad_complete INTEGER NOT NULL DEFAULT 0, starter_count INTEGER NOT NULL DEFAULT 0,
  player_count INTEGER NOT NULL DEFAULT 0, has_goalkeeper INTEGER NOT NULL DEFAULT 0,
  confidence_score REAL NOT NULL DEFAULT 0, confidence_label TEXT NOT NULL DEFAULT 'low',
  needs_review INTEGER NOT NULL DEFAULT 0, review_reason TEXT, source_record_id TEXT
);
CREATE TABLE IF NOT EXISTS players (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, nationality TEXT,
  identity_evidence TEXT NOT NULL, wiki_title TEXT
);
CREATE TABLE IF NOT EXISTS player_aliases (
  id INTEGER PRIMARY KEY AUTOINCREMENT, player_id TEXT NOT NULL, alias TEXT NOT NULL, source_record_id TEXT
);
CREATE TABLE IF NOT EXISTS player_seasons (
  id TEXT PRIMARY KEY, player_id TEXT NOT NULL, club_season_id TEXT NOT NULL,
  pos TEXT NOT NULL, positions TEXT NOT NULL DEFAULT '[]',
  pos_group TEXT NOT NULL, pos_inferred INTEGER NOT NULL DEFAULT 0,
  shirt INTEGER, nationality TEXT, captain INTEGER NOT NULL DEFAULT 0, role TEXT NOT NULL,
  squad_role TEXT NOT NULL DEFAULT 'unknown',
  final_goals INTEGER NOT NULL DEFAULT 0, continental_apps INTEGER, continental_goals INTEGER,
  continental_starts INTEGER, league_apps INTEGER, league_goals INTEGER,
  confidence_score REAL NOT NULL DEFAULT 0,
  confidence_label TEXT NOT NULL DEFAULT 'low', needs_review INTEGER NOT NULL DEFAULT 0,
  review_reason TEXT, source_record_id TEXT
);
CREATE TABLE IF NOT EXISTS squads (
  id INTEGER PRIMARY KEY AUTOINCREMENT, club_season_id TEXT NOT NULL, player_season_id TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS matches (
  id TEXT PRIMARY KEY, round_id TEXT NOT NULL, season_id TEXT NOT NULL, date TEXT,
  home_club_season_id TEXT NOT NULL, away_club_season_id TEXT NOT NULL,
  home_goals INTEGER NOT NULL, away_goals INTEGER NOT NULL,
  extra_time INTEGER NOT NULL DEFAULT 0, penalties TEXT, venue TEXT, source_record_id TEXT
);
CREATE TABLE IF NOT EXISTS appearances (
  id INTEGER PRIMARY KEY AUTOINCREMENT, match_id TEXT NOT NULL, player_season_id TEXT NOT NULL,
  started INTEGER NOT NULL, came_on INTEGER NOT NULL DEFAULT 0, minute_on INTEGER, minute_off INTEGER
);
CREATE TABLE IF NOT EXISTS goals (
  id INTEGER PRIMARY KEY AUTOINCREMENT, match_id TEXT NOT NULL, player_season_id TEXT,
  scorer_name TEXT NOT NULL, minute TEXT, penalty INTEGER NOT NULL DEFAULT 0,
  own_goal INTEGER NOT NULL DEFAULT 0, for_club_season_id TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS positions (
  code TEXT PRIMARY KEY, group_code TEXT NOT NULL, label TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS ratings (
  player_season_id TEXT PRIMARY KEY, overall REAL NOT NULL, attack REAL NOT NULL, control REAL NOT NULL,
  defense REAL NOT NULL, physical REAL NOT NULL, goalkeeping REAL NOT NULL, clutch REAL NOT NULL,
  ucl_aura REAL NOT NULL, rarity REAL NOT NULL, formula_version TEXT NOT NULL,
  override_applied INTEGER NOT NULL DEFAULT 0, explanation TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS data_quality_flags (
  id INTEGER PRIMARY KEY AUTOINCREMENT, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL,
  flag_type TEXT NOT NULL, severity TEXT NOT NULL, detail TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS manual_overrides (
  id INTEGER PRIMARY KEY AUTOINCREMENT, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL,
  fields_changed TEXT NOT NULL, reason TEXT NOT NULL, author_note TEXT NOT NULL, date TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS simulation_versions (
  version TEXT PRIMARY KEY, notes TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS draft_seeds (
  seed TEXT PRIMARY KEY, data_version TEXT NOT NULL, sim_version TEXT NOT NULL,
  formation TEXT NOT NULL, outcome TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS h2h_battles (
  id TEXT PRIMARY KEY, seed_a TEXT NOT NULL, seed_b TEXT NOT NULL, mode TEXT NOT NULL,
  sim_version TEXT NOT NULL, winner TEXT, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ps_club_season ON player_seasons(club_season_id);
CREATE INDEX IF NOT EXISTS idx_ps_player ON player_seasons(player_id);
CREATE INDEX IF NOT EXISTS idx_flags_entity ON data_quality_flags(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_goals_match ON goals(match_id);
`;

export type Db = BetterSQLite3Database<typeof schema>;

/** Canonical-layer tables: rebuildable from raw; dropped + recreated by clean. */
export const CANONICAL_TABLES = [
  "competitions", "seasons", "rounds", "clubs", "club_aliases", "club_seasons",
  "players", "player_aliases", "player_seasons", "squads", "matches",
  "appearances", "goals", "positions", "ratings", "data_quality_flags", "manual_overrides",
] as const;

export { DDL };

export function openDb(): { db: Db; sqlite: Database.Database } {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const sqlite = new Database(DB_PATH);
  sqlite.pragma("journal_mode = WAL");
  sqlite.exec(DDL);
  const db = drizzle(sqlite, { schema });
  return { db, sqlite };
}

export { schema };
