/**
 * DATA QUALITY REPORT:
 *
 *   npm run data-quality-report
 *
 * Prints a console summary and writes data/reports/quality.json (full) plus
 * public/quality-report.json (consumed by the /data screen).
 */
import fs from "node:fs";
import path from "node:path";
import { openDb } from "../../db";
import { buildQualitySummary } from "./quality";

const { sqlite } = openDb();
const summary = buildQualitySummary(sqlite);

const sources = sqlite
  .prepare("SELECT id, name, status, status_note, confidence_level, license_note, retrieved_at FROM sources")
  .all();
const overrides = sqlite
  .prepare("SELECT entity_type, entity_id, fields_changed, reason, author_note, date FROM manual_overrides")
  .all();
const worstFlags = sqlite
  .prepare(
    "SELECT entity_type, entity_id, flag_type, severity, detail FROM data_quality_flags WHERE severity IN ('error','warn') ORDER BY severity, flag_type LIMIT 200",
  )
  .all();

const full = { generatedAt: new Date().toISOString(), summary, sources, overrides, warnings: worstFlags };

const reportsDir = path.join(process.cwd(), "data", "reports");
fs.mkdirSync(reportsDir, { recursive: true });
fs.writeFileSync(path.join(reportsDir, "quality.json"), JSON.stringify(full, null, 2), "utf8");
fs.mkdirSync(path.join(process.cwd(), "public"), { recursive: true });
fs.writeFileSync(path.join(process.cwd(), "public", "quality-report.json"), JSON.stringify(full), "utf8");

console.log("DATA QUALITY REPORT");
console.log("===================");
for (const [k, v] of Object.entries(summary)) {
  if (typeof v === "number") console.log(`  ${k}: ${v}`);
}
console.log("  coverageByDecade:", JSON.stringify(summary.coverageByDecade));
console.log("  flagsByType:", JSON.stringify(summary.flagsByType));
console.log("  next cleanup tasks:");
for (const task of summary.nextCleanupTasks) console.log(`   - ${task}`);
sqlite.close();
