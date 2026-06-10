/**
 * Entity resolution: clubs and players.
 *
 * Clubs: Wikipedia link targets vary across eras ("Real Madrid CF",
 * "Real Madrid C.F.", "Steaua București" vs "FCSB" era names...). We resolve
 * through (1) a curated alias map for known European Cup/UCL finalists and
 * (2) generic prefix/suffix cleaning as fallback. Historical names are
 * preserved as aliases, never overwritten.
 *
 * Players: the Wikipedia article title (link target) is the primary identity
 * evidence — it is unique per person on en.wikipedia and stable across the
 * finals pages. Plain-text players (no article) fall back to a normalized
 * name key and are flagged for review.
 */

export function deaccent(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[øØ]/g, "o")
    .replace(/[đĐ]/g, "d")
    .replace(/[łŁ]/g, "l")
    .replace(/[ßẞ]/g, "ss")
    .replace(/[æÆ]/g, "ae");
}

export function slugify(s: string): string {
  return deaccent(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Strip Wikipedia disambiguators: "Marquitos (footballer, born 1933)" -> "Marquitos" */
export function stripDisambiguation(s: string): string {
  return s.replace(/\s*\([^)]*\)\s*$/, "").trim();
}

interface CanonicalClub {
  id: string;
  name: string;
  country: string;
}

/**
 * Curated club canonicalization for every European Cup / UCL finalist club.
 * Keys are lowercase, deaccented match keys (after generic cleaning).
 * Sourced from the finals list itself; this is normalization logic, not data.
 */
const CLUB_ALIAS_MAP: Record<string, CanonicalClub> = (() => {
  const defs: Array<[string, string, string, string[]]> = [
    // [canonical id, display name, country, alias match keys]
    ["real-madrid", "Real Madrid", "Spain", ["real madrid", "real madrid cf", "real madrid c f"]],
    ["benfica", "Benfica", "Portugal", ["benfica", "sl benfica", "s l benfica"]],
    ["milan", "Milan", "Italy", ["milan", "ac milan", "a c milan", "associazione calcio milan"]],
    ["inter", "Inter Milan", "Italy", ["inter milan", "internazionale", "fc internazionale milano", "inter"]],
    ["celtic", "Celtic", "Scotland", ["celtic", "celtic fc", "celtic f c"]],
    ["manchester-united", "Manchester United", "England", ["manchester united", "manchester united fc", "manchester united f c"]],
    ["feyenoord", "Feyenoord", "Netherlands", ["feyenoord", "feyenoord rotterdam"]],
    ["ajax", "Ajax", "Netherlands", ["ajax", "afc ajax", "ajax amsterdam"]],
    ["bayern-munich", "Bayern Munich", "Germany", ["bayern munich", "fc bayern munich", "bayern munchen", "fc bayern munchen", "bayern"]],
    ["liverpool", "Liverpool", "England", ["liverpool", "liverpool fc", "liverpool f c"]],
    ["nottingham-forest", "Nottingham Forest", "England", ["nottingham forest", "nottingham forest fc", "nottingham forest f c"]],
    ["aston-villa", "Aston Villa", "England", ["aston villa", "aston villa fc", "aston villa f c"]],
    ["hamburg", "Hamburg", "Germany", ["hamburg", "hamburger sv", "hamburg sv"]],
    ["juventus", "Juventus", "Italy", ["juventus", "juventus fc", "juventus f c"]],
    ["steaua-bucuresti", "Steaua București", "Romania", ["steaua bucuresti", "fc steaua bucuresti", "csa steaua bucuresti", "steaua", "fcsb"]],
    ["porto", "Porto", "Portugal", ["porto", "fc porto"]],
    ["psv", "PSV Eindhoven", "Netherlands", ["psv eindhoven", "psv"]],
    ["red-star-belgrade", "Red Star Belgrade", "Serbia", ["red star belgrade", "fk crvena zvezda", "crvena zvezda"]],
    ["barcelona", "Barcelona", "Spain", ["barcelona", "fc barcelona"]],
    ["marseille", "Marseille", "France", ["marseille", "olympique de marseille", "olympique marseille"]],
    ["borussia-dortmund", "Borussia Dortmund", "Germany", ["borussia dortmund", "bv borussia 09 dortmund"]],
    ["chelsea", "Chelsea", "England", ["chelsea", "chelsea fc", "chelsea f c"]],
    ["manchester-city", "Manchester City", "England", ["manchester city", "manchester city fc", "manchester city f c"]],
    ["paris-saint-germain", "Paris Saint-Germain", "France", ["paris saint germain", "paris saint germain fc", "paris saint germain f c", "psg"]],
    ["reims", "Reims", "France", ["reims", "stade de reims", "stade reims"]],
    ["fiorentina", "Fiorentina", "Italy", ["fiorentina", "acf fiorentina", "ac fiorentina"]],
    ["eintracht-frankfurt", "Eintracht Frankfurt", "Germany", ["eintracht frankfurt"]],
    ["partizan", "Partizan", "Serbia", ["partizan", "fk partizan", "partizan belgrade"]],
    ["panathinaikos", "Panathinaikos", "Greece", ["panathinaikos", "panathinaikos fc", "panathinaikos f c"]],
    ["atletico-madrid", "Atlético Madrid", "Spain", ["atletico madrid", "atletico de madrid", "club atletico de madrid"]],
    ["leeds-united", "Leeds United", "England", ["leeds united", "leeds united fc", "leeds united afc", "leeds united a f c"]],
    ["saint-etienne", "Saint-Étienne", "France", ["saint etienne", "as saint etienne"]],
    ["borussia-monchengladbach", "Borussia Mönchengladbach", "Germany", ["borussia monchengladbach", "borussia mongengladbach"]],
    ["club-brugge", "Club Brugge", "Belgium", ["club brugge", "club brugge kv", "club bruges"]],
    ["malmo", "Malmö FF", "Sweden", ["malmo ff", "malmo"]],
    ["roma", "Roma", "Italy", ["roma", "as roma", "a s roma"]],
    ["sampdoria", "Sampdoria", "Italy", ["sampdoria", "uc sampdoria", "u c sampdoria"]],
    ["olympique-lyonnais", "Lyon", "France", ["lyon", "olympique lyonnais"]],
    ["valencia", "Valencia", "Spain", ["valencia", "valencia cf", "valencia c f"]],
    ["bayer-leverkusen", "Bayer Leverkusen", "Germany", ["bayer leverkusen", "bayer 04 leverkusen"]],
    ["monaco", "Monaco", "France", ["monaco", "as monaco", "as monaco fc"]],
    ["arsenal", "Arsenal", "England", ["arsenal", "arsenal fc", "arsenal f c"]],
    ["tottenham-hotspur", "Tottenham Hotspur", "England", ["tottenham hotspur", "tottenham hotspur fc", "tottenham hotspur f c", "tottenham"]],
    ["dinamo-zagreb", "Dinamo Zagreb", "Croatia", ["dinamo zagreb", "gnk dinamo zagreb"]],
    ["rangers", "Rangers", "Scotland", ["rangers", "rangers fc", "rangers f c"]],
    // curated iconic non-finalists (stable ids across curation + match data)
    ["atalanta", "Atalanta", "Italy", ["atalanta", "atalanta bc", "atalanta b c", "atalanta bergamo"]],
    ["villarreal", "Villarreal", "Spain", ["villarreal", "villarreal cf", "villarreal c f"]],
    ["deportivo-la-coruna", "Deportivo La Coruña", "Spain", ["deportivo de la coruna", "deportivo la coruna", "rc deportivo de la coruna", "rc deportivo", "deportivo"]],
    ["malaga", "Málaga", "Spain", ["malaga", "malaga cf", "malaga c f"]],
    ["apoel", "APOEL", "Cyprus", ["apoel", "apoel fc", "apoel f c", "apoel nicosia"]],
    ["dynamo-kyiv", "Dynamo Kyiv", "Ukraine", ["dynamo kyiv", "fc dynamo kyiv", "dynamo kiev", "dinamo kiev", "dinamo kyiv"]],
    ["shakhtar-donetsk", "Shakhtar Donetsk", "Ukraine", ["shakhtar donetsk", "fc shakhtar donetsk", "shakhtar"]],
    ["galatasaray", "Galatasaray", "Turkey", ["galatasaray", "galatasaray sk", "galatasaray s k"]],
    ["napoli", "Napoli", "Italy", ["napoli", "ssc napoli", "s s c napoli"]],
    ["schalke-04", "Schalke 04", "Germany", ["schalke 04", "fc schalke 04", "schalke"]],
    ["basel", "Basel", "Switzerland", ["basel", "fc basel", "fc basel 1893"]],
    ["fenerbahce", "Fenerbahçe", "Turkey", ["fenerbahce", "fenerbahce sk", "fenerbahce s k"]],
    ["rb-leipzig", "RB Leipzig", "Germany", ["rb leipzig", "rasenballsport leipzig"]],
    ["sturm-graz", "Sturm Graz", "Austria", ["sturm graz", "sk sturm graz"]],
    ["dundee-united", "Dundee United", "Scotland", ["dundee united", "dundee united fc", "dundee united f c"]],
    ["ifk-goteborg", "IFK Göteborg", "Sweden", ["ifk goteborg", "ifk gothenburg"]],
    ["widzew-lodz", "Widzew Łódź", "Poland", ["widzew lodz", "rts widzew lodz"]],
    ["rosenborg", "Rosenborg", "Norway", ["rosenborg", "rosenborg bk"]],
    ["spartak-moscow", "Spartak Moscow", "Russia", ["spartak moscow", "fc spartak moscow", "spartak moskva"]],
    ["nantes", "Nantes", "France", ["nantes", "fc nantes", "fc nantes atlantique"]],
  ];
  const map: Record<string, CanonicalClub> = {};
  for (const [id, name, country, aliases] of defs) {
    for (const a of aliases) map[a] = { id, name, country };
  }
  return map;
})();

/** Generic cleaning used to build a match key from a raw club string. */
export function clubMatchKey(raw: string): string {
  let s = stripDisambiguation(raw);
  s = deaccent(s).toLowerCase();
  s = s.replace(/[^a-z0-9]+/g, " ").trim();
  return s;
}

export interface ResolvedClub {
  clubId: string;
  canonicalName: string;
  country: string | null;
  matchedVia: "alias-map" | "fallback";
  rawName: string;
}

export function resolveClub(raw: string): ResolvedClub {
  const key = clubMatchKey(raw);
  const hit = CLUB_ALIAS_MAP[key];
  if (hit) {
    return { clubId: hit.id, canonicalName: hit.name, country: hit.country, matchedVia: "alias-map", rawName: raw };
  }
  // Fallback: strip common legal-form tokens then slug.
  const cleaned = key
    .replace(/\b(fc|cf|afc|ac|as|sl|sv|kv|fk|bsc|ssc|uc|cd|sc|f c|a c)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const name = stripDisambiguation(raw);
  return {
    clubId: slugify(cleaned || key),
    canonicalName: name,
    country: null,
    matchedVia: "fallback",
    rawName: raw,
  };
}

export interface ResolvedPlayer {
  playerId: string;
  displayName: string;
  identityEvidence: "wikilink" | "name-only";
}

/**
 * Resolve a player from a wikilink target + display text.
 * The link target ("Marquitos (footballer, born 1933)") keeps genuinely
 * different same-name players separate; the display name is what we show.
 */
export function resolvePlayer(linkTarget: string | null, displayText: string): ResolvedPlayer {
  if (linkTarget) {
    return {
      playerId: "p-" + slugify(linkTarget),
      displayName: stripDisambiguation(displayText || linkTarget),
      identityEvidence: "wikilink",
    };
  }
  const name = displayText.trim();
  return {
    playerId: "p-" + slugify(name),
    displayName: name,
    identityEvidence: "name-only",
  };
}

/** Map a historical position code (incl. 1950s WM-formation codes) to a group. */
export function posToGroup(pos: string): PosGroupResult {
  const p = pos.toUpperCase().trim();
  const table: Record<string, { group: "GK" | "DF" | "MF" | "FW"; confident: boolean }> = {
    GK: { group: "GK", confident: true },
    RB: { group: "DF", confident: true },
    LB: { group: "DF", confident: true },
    CB: { group: "DF", confident: true },
    SW: { group: "DF", confident: true },
    DF: { group: "DF", confident: true },
    FB: { group: "DF", confident: true },
    WB: { group: "DF", confident: true },
    RWB: { group: "DF", confident: true },
    LWB: { group: "DF", confident: true },
    // WM / 2-3-5-era codes
    RH: { group: "MF", confident: true }, // right half
    LH: { group: "MF", confident: true }, // left half
    CH: { group: "DF", confident: false }, // centre half: defensive in WM, ambiguous earlier
    WH: { group: "MF", confident: true },
    MF: { group: "MF", confident: true },
    CM: { group: "MF", confident: true },
    DM: { group: "MF", confident: true },
    AM: { group: "MF", confident: true },
    RM: { group: "MF", confident: true },
    LM: { group: "MF", confident: true },
    IR: { group: "FW", confident: true }, // inside right
    IL: { group: "FW", confident: true }, // inside left
    IF: { group: "FW", confident: true },
    OR: { group: "FW", confident: true }, // outside right (winger)
    OL: { group: "FW", confident: true }, // outside left
    RW: { group: "FW", confident: true },
    LW: { group: "FW", confident: true },
    CF: { group: "FW", confident: true },
    SS: { group: "FW", confident: true },
    ST: { group: "FW", confident: true },
    FW: { group: "FW", confident: true },
  };
  const hit = table[p];
  if (hit) return { group: hit.group, confident: hit.confident, raw: p };
  return { group: "MF", confident: false, raw: p };
}

export interface PosGroupResult {
  group: "GK" | "DF" | "MF" | "FW";
  confident: boolean;
  raw: string;
}

/** "1959–60" or "1959-60" -> { seasonId: "1959-60", endYear: 1960 } */
export function normalizeSeason(raw: string): { seasonId: string; endYear: number } | null {
  const m = raw.replace(/–/g, "-").match(/(\d{4})-(\d{2,4})/);
  if (!m) return null;
  const start = parseInt(m[1], 10);
  let end = parseInt(m[2], 10);
  if (end < 100) end = Math.floor(start / 100) * 100 + end;
  if (end < start) end += 100; // 1999-00 case
  return { seasonId: `${start}-${String(end).padStart(2, "0").slice(-2)}`, endYear: end };
}

export function eraLabel(endYear: number): string {
  const decade = Math.floor(endYear / 10) * 10;
  return `${decade}s`;
}
