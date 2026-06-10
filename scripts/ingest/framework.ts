/**
 * Ingestion framework: source registry + raw-layer persistence.
 *
 * Raw payloads are written verbatim to data/raw/<sourceId>/<key>.json and
 * never overwritten by later pipeline stages (re-running ingest refreshes
 * them; clean/export only read). Every payload carries provenance metadata.
 */
import fs from "node:fs";
import path from "node:path";
import { openDb, type Db } from "../../db";
import { sources, sourceRecords } from "../../db/schema";
import { slugify } from "../../lib/identity/normalize";
import { fingerprint } from "../../lib/rng";

export const PARSER_VERSION = "1.0.0";
export const USER_AGENT =
  "ImmortalXI-data-pipeline/1.0 (research/educational; contact: https://github.com/TanmayKallakuri/immortal-xi)";

export interface SourceDef {
  id: string;
  name: string;
  url: string;
  dataType: string;
  parser: string;
  confidenceLevel: "high" | "medium" | "low";
  licenseNote: string;
  redistributable: boolean;
  internalDerivationOnly: boolean;
}

/**
 * Source registry. Facts (names, dates, scores, lineups) are not
 * copyrightable; we ingest factual records, derive our own canonical data
 * and ratings, and never republish source pages or database dumps.
 */
export const SOURCE_DEFS: SourceDef[] = [
  {
    id: "wikipedia-finals-list",
    name: "Wikipedia: List of European Cup and UEFA Champions League finals",
    url: "https://en.wikipedia.org/wiki/List_of_European_Cup_and_UEFA_Champions_League_finals",
    dataType: "wikitext",
    parser: "finals-list",
    confidenceLevel: "high",
    licenseNote: "CC BY-SA 4.0 (text); factual records derived",
    redistributable: true,
    internalDerivationOnly: false,
  },
  {
    id: "wikipedia-final-pages",
    name: "Wikipedia: individual European Cup / UCL final articles (1956->latest)",
    url: "https://en.wikipedia.org/wiki/1956_European_Cup_final",
    dataType: "wikitext",
    parser: "final-page",
    confidenceLevel: "high",
    licenseNote: "CC BY-SA 4.0 (text); factual records derived",
    redistributable: true,
    internalDerivationOnly: false,
  },
  {
    id: "wikipedia-club-season-pages",
    name: "Wikipedia: club-season articles for curated iconic teams (squad lists)",
    url: "https://en.wikipedia.org/wiki/2018%E2%80%9319_AFC_Ajax_season",
    dataType: "wikitext",
    parser: "club-season-page",
    confidenceLevel: "medium",
    licenseNote: "CC BY-SA 4.0 (text); factual squad records derived",
    redistributable: true,
    internalDerivationOnly: false,
  },
  {
    id: "footballcsv-cl",
    name: "footballcsv: europe-champions-league match results",
    url: "https://github.com/footballcsv/europe-champions-league",
    dataType: "csv",
    parser: "footballcsv",
    confidenceLevel: "medium",
    licenseNote: "Public domain (CC0) per repo",
    redistributable: true,
    internalDerivationOnly: false,
  },
  {
    id: "uefa-official",
    name: "UEFA.com official history pages",
    url: "https://www.uefa.com/uefachampionsleague/history/",
    dataType: "html",
    parser: "none",
    confidenceLevel: "high",
    licenseNote: "Proprietary; terms restrict scraping/republication",
    redistributable: false,
    internalDerivationOnly: true,
  },
  {
    id: "kaggle-datasets",
    name: "Kaggle football history datasets",
    url: "https://www.kaggle.com/datasets",
    dataType: "csv",
    parser: "none",
    confidenceLevel: "medium",
    licenseNote: "Per-dataset; requires authenticated API",
    redistributable: false,
    internalDerivationOnly: true,
  },
  {
    id: "fbref",
    name: "FBref historical competition pages",
    url: "https://fbref.com/en/comps/8/history/Champions-League-Seasons",
    dataType: "html",
    parser: "none",
    confidenceLevel: "high",
    licenseNote: "Sports Reference terms restrict automated scraping",
    redistributable: false,
    internalDerivationOnly: true,
  },
];

export const RAW_DIR = path.join(process.cwd(), "data", "raw");

export interface RawPayload {
  sourceId: string;
  recordKey: string;
  url: string;
  retrievedAt: string;
  parserVersion: string;
  payload: string;
}

export function rawPathFor(sourceId: string, recordKey: string): string {
  return path.join(RAW_DIR, sourceId, slugify(recordKey) + ".json");
}

export function saveRaw(db: Db, p: RawPayload): string {
  const file = rawPathFor(p.sourceId, p.recordKey);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(p, null, 2), "utf8");
  const rel = path.relative(process.cwd(), file).replace(/\\/g, "/");
  const id = `${p.sourceId}:${slugify(p.recordKey)}`;
  db.insert(sourceRecords)
    .values({
      id,
      sourceId: p.sourceId,
      recordKey: p.recordKey,
      url: p.url,
      retrievedAt: p.retrievedAt,
      parserVersion: p.parserVersion,
      rawPath: rel,
      contentHash: fingerprint(p.payload),
    })
    .onConflictDoUpdate({
      target: sourceRecords.id,
      set: {
        retrievedAt: p.retrievedAt,
        parserVersion: p.parserVersion,
        rawPath: rel,
        contentHash: fingerprint(p.payload),
      },
    })
    .run();
  return id;
}

export function loadRaw(sourceId: string, recordKey: string): RawPayload | null {
  const file = rawPathFor(sourceId, recordKey);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf8")) as RawPayload;
}

export function listRaw(sourceId: string): RawPayload[] {
  const dir = path.join(RAW_DIR, sourceId);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as RawPayload);
}

export function registerSources(db: Db): void {
  for (const s of SOURCE_DEFS) {
    db.insert(sources)
      .values({
        id: s.id,
        name: s.name,
        url: s.url,
        dataType: s.dataType,
        parser: s.parser,
        parserVersion: PARSER_VERSION,
        confidenceLevel: s.confidenceLevel,
        licenseNote: s.licenseNote,
        redistributable: s.redistributable,
        internalDerivationOnly: s.internalDerivationOnly,
        status: "registered",
        statusNote: "",
        retrievedAt: null,
      })
      .onConflictDoNothing()
      .run();
  }
}

export function setSourceStatus(
  db: Db,
  id: string,
  status: "ok" | "blocked" | "registered",
  note: string,
): void {
  db.update(sources)
    .set({ status, statusNote: note, retrievedAt: new Date().toISOString() })
    .where(eqId(id))
    .run();
}

import { eq } from "drizzle-orm";
function eqId(id: string) {
  return eq(sources.id, id);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function fetchText(url: string, attempts = 3): Promise<string> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
      if (res.status === 404) throw Object.assign(new Error("404"), { permanent: true });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (e) {
      lastErr = e;
      if ((e as { permanent?: boolean }).permanent) throw e;
      await sleep(800 * (i + 1));
    }
  }
  throw lastErr;
}

const WIKI_API = "https://en.wikipedia.org/w/api.php";

export async function fetchWikitext(pageTitle: string): Promise<{ title: string; wikitext: string; url: string }> {
  const url =
    `${WIKI_API}?action=parse&format=json&formatversion=2&prop=wikitext&redirects=1&page=` +
    encodeURIComponent(pageTitle);
  const body = await fetchText(url);
  const json = JSON.parse(body) as {
    parse?: { title: string; wikitext: string };
    error?: { info?: string };
  };
  if (!json.parse) {
    throw Object.assign(new Error(`wiki page missing: ${pageTitle} (${json.error?.info ?? "unknown"})`), {
      permanent: true,
    });
  }
  return { title: json.parse.title, wikitext: json.parse.wikitext, url };
}

export function openPipelineDb() {
  return openDb();
}

export { sleep };
