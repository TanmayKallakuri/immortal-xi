/** Dev tool: parse one raw final page and print attribution inputs. */
import { loadRaw } from "../ingest/framework";
import { parseFinalPage } from "../clean/parsers";

const key = process.argv[2] ?? "2018 UEFA Champions League final";
const raw = loadRaw("wikipedia-final-pages", key);
if (!raw) {
  console.error("no raw payload for", key);
  process.exit(1);
}
const p = parseFinalPage(raw.payload);
console.log("kitTitles:", p.kitTitles);
console.log("anomalies:", p.anomalies);
console.log(
  "blocks:",
  p.lineups.map((b) => ({
    kit: b.kitTitle,
    manager: b.manager,
    n: b.players.length,
    starters: b.players.filter((x) => x.isStarter).length,
    first: b.players[0]?.displayName,
  })),
);
console.log(
  "boxes:",
  p.matches.map((m) => ({ t1: m.team1Link, t2: m.team2Link, score: m.score, goals: m.goals.length })),
);
