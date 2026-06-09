/** Ad-hoc canonical-layer inspection helper (dev tool). */
import Database from "better-sqlite3";

const db = new Database("data/immortal.db");
console.log("--- flags by type ---");
console.table(
  db.prepare("SELECT flag_type, severity, COUNT(*) n FROM data_quality_flags GROUP BY flag_type, severity ORDER BY n DESC").all(),
);
console.log("--- incomplete finalist squads ---");
console.table(
  db
    .prepare(
      "SELECT id, starter_count, player_count, has_goalkeeper FROM club_seasons WHERE progression IN ('W','RU') AND squad_complete = 0 ORDER BY id",
    )
    .all(),
);
