/**
 * INGEST: fetch raw payloads from every registered source.
 *
 *   npm run ingest
 *
 * - Wikipedia finals list  -> one wikitext payload
 * - Wikipedia final pages  -> one wikitext payload per final (1956 -> latest)
 * - footballcsv            -> CSV match results per available season
 * - UEFA / Kaggle / FBref  -> registered; blocked (terms/auth/JS), logged
 *
 * Unavailable sources are marked blocked with a reason and the run continues.
 * Raw payloads land in data/raw/<source>/ and are never modified afterwards.
 */
import fs from "node:fs";
import path from "node:path";
import {
  registerSources,
  setSourceStatus,
  saveRaw,
  loadRaw,
  fetchWikitext,
  fetchText,
  sleep,
  openPipelineDb,
  PARSER_VERSION,
  USER_AGENT,
  RAW_DIR,
} from "./framework";
import { parseFinalsList } from "../clean/parsers";

const FINALS_LIST_PAGE = "List of European Cup and UEFA Champions League finals";

interface IngestLog {
  startedAt: string;
  finishedAt?: string;
  sources: Record<string, { status: string; note: string; records: number }>;
}

async function main() {
  const { db, sqlite } = openPipelineDb();
  registerSources(db);
  const log: IngestLog = { startedAt: new Date().toISOString(), sources: {} };

  // ---- 1. Finals list ----
  let finalPages: string[] = [];
  try {
    const { wikitext, url } = await fetchWikitext(FINALS_LIST_PAGE);
    saveRaw(db, {
      sourceId: "wikipedia-finals-list",
      recordKey: FINALS_LIST_PAGE,
      url,
      retrievedAt: new Date().toISOString(),
      parserVersion: PARSER_VERSION,
      payload: wikitext,
    });
    const parsed = parseFinalsList(wikitext);
    finalPages = [...new Set(parsed.rows.map((r) => r.finalPage))];
    setSourceStatus(db, "wikipedia-finals-list", "ok", `parsed ${parsed.rows.length} final rows`);
    log.sources["wikipedia-finals-list"] = {
      status: "ok",
      note: `${parsed.rows.length} finals`,
      records: 1,
    };
    console.log(`[finals-list] ok — ${parsed.rows.length} finals, ${finalPages.length} pages`);
  } catch (e) {
    setSourceStatus(db, "wikipedia-finals-list", "blocked", String(e));
    log.sources["wikipedia-finals-list"] = { status: "blocked", note: String(e), records: 0 };
    console.error(`[finals-list] BLOCKED: ${e}`);
  }

  // ---- 2. Final pages ----
  let okPages = 0;
  const failedPages: string[] = [];
  for (const page of finalPages) {
    try {
      if (loadRaw("wikipedia-final-pages", page)) {
        okPages++;
        continue; // already ingested; raw layer is append-only
      }
      const { wikitext, url, title } = await fetchWikitext(page);
      saveRaw(db, {
        sourceId: "wikipedia-final-pages",
        recordKey: title,
        url,
        retrievedAt: new Date().toISOString(),
        parserVersion: PARSER_VERSION,
        payload: wikitext,
      });
      okPages++;
      if (okPages % 10 === 0) console.log(`[final-pages] ${okPages}/${finalPages.length}...`);
      await sleep(250); // politeness
    } catch (e) {
      failedPages.push(page);
      console.error(`[final-pages] failed: ${page}: ${e}`);
    }
  }
  setSourceStatus(
    db,
    "wikipedia-final-pages",
    okPages > 0 ? "ok" : "blocked",
    `${okPages}/${finalPages.length} pages fetched` +
      (failedPages.length ? `; failed: ${failedPages.join(", ")}` : ""),
  );
  log.sources["wikipedia-final-pages"] = {
    status: okPages > 0 ? "ok" : "blocked",
    note: `${okPages}/${finalPages.length}`,
    records: okPages,
  };
  console.log(`[final-pages] done — ${okPages}/${finalPages.length}`);

  // ---- 3. footballcsv match results ----
  try {
    // One git-trees API call (rate-limit friendly), then raw downloads.
    let tree: Array<{ path: string; type: string }> = [];
    let branch = "master";
    for (const b of ["master", "main"]) {
      try {
        const res = JSON.parse(
          await fetchText(
            `https://api.github.com/repos/footballcsv/europe-champions-league/git/trees/${b}?recursive=1`,
          ),
        ) as { tree?: Array<{ path: string; type: string }> };
        if (res.tree) {
          tree = res.tree;
          branch = b;
          break;
        }
      } catch {
        /* try next branch */
      }
    }
    const csvFiles = tree.filter((e) => e.type === "blob" && e.path.endsWith(".csv"));
    let csvCount = 0;
    for (const f of csvFiles) {
      if (loadRaw("footballcsv-cl", f.path)) {
        csvCount++;
        continue;
      }
      const url = `https://raw.githubusercontent.com/footballcsv/europe-champions-league/${branch}/${f.path}`;
      const csv = await fetchText(url);
      saveRaw(db, {
        sourceId: "footballcsv-cl",
        recordKey: f.path,
        url,
        retrievedAt: new Date().toISOString(),
        parserVersion: PARSER_VERSION,
        payload: csv,
      });
      csvCount++;
      if (csvCount % 15 === 0) console.log(`[footballcsv] ${csvCount}/${csvFiles.length}...`);
      await sleep(120);
    }
    setSourceStatus(db, "footballcsv-cl", csvCount > 0 ? "ok" : "blocked", `${csvCount} CSV files`);
    log.sources["footballcsv-cl"] = { status: csvCount > 0 ? "ok" : "blocked", note: `${csvCount} csv`, records: csvCount };
    console.log(`[footballcsv] done — ${csvCount} files`);
  } catch (e) {
    setSourceStatus(db, "footballcsv-cl", "blocked", `unavailable during ingest: ${e}`);
    log.sources["footballcsv-cl"] = { status: "blocked", note: String(e), records: 0 };
    console.error(`[footballcsv] BLOCKED: ${e}`);
  }

  // ---- 4. Sources we register but do not scrape ----
  setSourceStatus(
    db,
    "uefa-official",
    "blocked",
    "JS-rendered app with restrictive terms; no stable parseable payload. Used as manual cross-check reference only.",
  );
  setSourceStatus(
    db,
    "kaggle-datasets",
    "blocked",
    "Requires authenticated Kaggle API credentials; not available in this environment.",
  );
  setSourceStatus(
    db,
    "fbref",
    "blocked",
    "Sports Reference terms restrict automated scraping; skipped by policy.",
  );
  for (const id of ["uefa-official", "kaggle-datasets", "fbref"]) {
    log.sources[id] = { status: "blocked", note: "see sources table", records: 0 };
  }

  log.finishedAt = new Date().toISOString();
  fs.mkdirSync(RAW_DIR, { recursive: true });
  fs.writeFileSync(path.join(RAW_DIR, "ingest-log.json"), JSON.stringify(log, null, 2), "utf8");
  console.log(`\nIngest complete. UA: ${USER_AGENT}`);
  sqlite.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
