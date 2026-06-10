/** Dev tool: parse one raw club-season page and print squad stats extraction. */
import fs from "node:fs";
import path from "node:path";
import { parseSquadPage } from "../clean/parsers";

const file = process.argv[2];
if (!file) {
  console.error("usage: tsx scripts/reports/debug-squad-parse.ts <raw-file-name>");
  process.exit(1);
}
const p = path.join(process.cwd(), "data", "raw", "wikipedia-club-season-pages", file);
const raw = JSON.parse(fs.readFileSync(p, "utf8")) as { payload: string };
const parsed = parseSquadPage(raw.payload);
console.log("players:", parsed.players.length, "hasSeasonStats:", parsed.hasSeasonStats);
console.log("anomalies:", parsed.anomalies);
for (const pl of parsed.players) {
  console.log(
    `${pl.displayName.padEnd(30)} ${pl.pos.padEnd(3)} euApps=${String(pl.continentalApps).padEnd(5)} euStarts=${String(pl.continentalStarts).padEnd(5)} euG=${String(pl.continentalGoals).padEnd(5)} lgApps=${String(pl.leagueApps).padEnd(5)} lgG=${pl.leagueGoals}`,
  );
}
