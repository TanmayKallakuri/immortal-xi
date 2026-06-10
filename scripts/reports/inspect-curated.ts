/** Dev tool: curated club-season ingestion status. */
import Database from "better-sqlite3";

const db = new Database("data/immortal.db");
console.log("--- squad-page anomalies ---");
console.table(
  db
    .prepare(
      "SELECT entity_id, flag_type, substr(detail,1,90) detail FROM data_quality_flags WHERE flag_type IN ('missing-squad-page','parse-anomaly') AND (detail LIKE '%season:%' OR detail LIKE '%season''%' OR detail LIKE '%season %')",
    )
    .all(),
);
console.log("--- curated club-seasons ---");
console.table(
  db
    .prepare(
      "SELECT id, category, squad_complete, player_count FROM club_seasons WHERE category NOT IN ('champion','runner_up','participant','group_stage','round_of_16','semi_finalist','quarter_finalist') OR tags != '[]' ORDER BY id",
    )
    .all(),
);
