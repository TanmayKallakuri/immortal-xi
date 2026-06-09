/**
 * Wikitext parsers for the finals list and individual final pages.
 *
 * These are deliberately conservative: anything that does not match the
 * expected shape becomes a parse anomaly (surfaced as a data quality flag),
 * never a guess. Parser version is recorded on every source record.
 */

export interface FinalsListRow {
  seasonRaw: string; // "1955–56"
  seasonPage: string; // "1955–56 European Cup"
  competition: "EC" | "UCL";
  finalPage: string; // "1956 European Cup final"
  scoreText: string; // cleaned display, e.g. "4–3" or "1–1 (5–4 pen.)"
  winnerLink: string; // wikilink target
  winnerDisplay: string;
  runnerUpLink: string;
  runnerUpDisplay: string;
  venueText: string | null;
  attendance: number | null;
  anomalies: string[];
}

const LINK_RE = /\[\[([^|\]]+)(?:\|([^\]]*))?\]\]/;

function firstLink(cell: string): { target: string; display: string } | null {
  const m = cell.match(LINK_RE);
  if (!m) return null;
  return { target: m[1].trim(), display: (m[2] ?? m[1]).trim() };
}

function stripMarkup(s: string): string {
  return s
    .replace(/\{\{efn[\s\S]*?\}\}/g, "")
    .replace(/\{\{sfn[\s\S]*?\}\}/g, "")
    .replace(/<ref[\s\S]*?<\/ref>/g, "")
    .replace(/<ref[^>]*\/>/g, "")
    .replace(/\{\{aet\}\}/gi, "(a.e.t.)")
    .replace(/\{\{(?:nowrap|small|center|nobr)\|([^{}]*)\}\}/gi, "$1")
    .replace(/\{\{(?:interlanguage link|ill)\|([^|}]+)[^}]*\}\}/gi, "$1")
    .replace(/\{\{[^}]*\}\}/g, "")
    .replace(/\[\[([^|\]]+)\|([^\]]*)\]\]/g, "$2")
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/'''?/g, "")
    .trim();
}

export function parseFinalsList(wikitext: string): { rows: FinalsListRow[]; anomalies: string[] } {
  const rows: FinalsListRow[] = [];
  const anomalies: string[] = [];
  // Split the main table into row chunks.
  const chunks = wikitext.split(/\n\|-/);
  for (const chunk of chunks) {
    const seasonMatch = chunk.match(
      /\[\[(\d{4}–\d{2}(?:\d{2})? (?:European Cup|UEFA Champions League))\|(\d{4}–\d{2,4})\]\]/,
    );
    if (!seasonMatch) continue;
    const finalLinkMatch = chunk.match(/\[\[((?:\d{4})[^|\]]*?[Ff]inal[^|\]]*?)\|([^\]]*)\]\]/);
    if (!finalLinkMatch) {
      // Season row without a final link (e.g. future season) — skip, note it.
      anomalies.push(`season row without final link: ${seasonMatch[2]}`);
      continue;
    }
    const lines = chunk.split("\n").filter((l) => l.startsWith("|") || l.startsWith("!"));
    const clubLinks: Array<{ target: string; display: string; line: string }> = [];
    let venueText: string | null = null;
    let attendance: number | null = null;
    let seenFinalLink = false;
    let winner: { target: string; display: string } | null = null;
    let runnerUp: { target: string; display: string } | null = null;

    for (const line of lines) {
      if (line.includes(finalLinkMatch[1])) {
        seenFinalLink = true;
        continue;
      }
      if (/\{\{fba\b/i.test(line) || /\{\{flagicon/i.test(line)) continue; // country cells
      if (/^!/.test(line) && !line.includes("[[")) continue;
      const link = firstLink(line);
      if (!link) {
        const att = stripMarkup(line.replace(/^[|!][^|]*\|/, "").replace(/^[|!]/, ""));
        const attNum = att.replace(/,/g, "");
        if (/^\d{4,6}$/.test(attNum) && attendance === null && seenFinalLink) {
          attendance = parseInt(attNum, 10);
        }
        continue;
      }
      if (link.target.includes("European Cup") && /^\d{4}–/.test(link.target)) continue; // season link
      if (link.target.includes("Champions League") && /^\d{4}–/.test(link.target)) continue;
      // Venue cells follow the runner-up; they usually contain stadium links.
      if (!seenFinalLink) {
        if (!winner) winner = link;
      } else {
        if (!runnerUp) runnerUp = link;
        else if (venueText === null) venueText = stripMarkup(line.replace(/^\|/, ""));
      }
      clubLinks.push({ ...link, line });
    }

    if (!winner || !runnerUp) {
      anomalies.push(`could not identify both finalists for ${seasonMatch[2]}`);
      continue;
    }
    rows.push({
      seasonRaw: seasonMatch[2],
      seasonPage: seasonMatch[1],
      competition: seasonMatch[1].includes("Champions League") ? "UCL" : "EC",
      finalPage: finalLinkMatch[1],
      scoreText: stripMarkup(finalLinkMatch[2]),
      winnerLink: winner.target,
      winnerDisplay: winner.display,
      runnerUpLink: runnerUp.target,
      runnerUpDisplay: runnerUp.display,
      venueText,
      attendance,
      anomalies: [],
    });
  }
  if (rows.length < 60) anomalies.push(`finals list parsed only ${rows.length} rows; expected 65+`);
  return { rows, anomalies };
}

// ---------------------------------------------------------------------------
// Final page parsing
// ---------------------------------------------------------------------------

export interface ParsedGoal {
  scorerLink: string | null;
  scorerDisplay: string;
  minute: string | null;
  penalty: boolean;
  ownGoal: boolean;
  team: 1 | 2;
}

export interface ParsedMatch {
  date: string | null;
  team1Link: string | null;
  team2Link: string | null;
  score: string | null; // "7–3"
  extraTime: boolean;
  penaltyScore: string | null;
  stadium: string | null;
  goals: ParsedGoal[];
}

export interface LineupPlayer {
  pos: string;
  shirt: number | null;
  nationality: string | null;
  linkTarget: string | null;
  displayName: string;
  captain: boolean;
  isStarter: boolean;
  subOnMinute: number | null;
  subOffMinute: number | null;
}

export interface LineupBlock {
  kitTitle: string | null; // club name from nearest preceding {{Football kit|title=...}}
  players: LineupPlayer[];
  manager: string | null;
}

export interface ParsedFinalPage {
  matches: ParsedMatch[];
  lineups: LineupBlock[];
  /** kit titles in document order; block i pairs with kitTitles[i % length] */
  kitTitles: string[];
  anomalies: string[];
}

/** Extract a {{...}} template starting at index `start` via brace counting. */
function extractTemplate(text: string, start: number): string | null {
  let depth = 0;
  for (let i = start; i < text.length - 1; i++) {
    if (text[i] === "{" && text[i + 1] === "{") {
      depth++;
      i++;
    } else if (text[i] === "}" && text[i + 1] === "}") {
      depth--;
      i++;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/** Split a template body into top-level |param=value parts. */
function templateParams(tpl: string): Record<string, string> {
  const inner = tpl.slice(2, -2);
  const parts: string[] = [];
  let depth = 0;
  let cur = "";
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    const next = inner[i + 1];
    if (c === "{" && next === "{") depth++;
    if (c === "}" && next === "}") depth--;
    if (c === "[" && next === "[") depth++;
    if (c === "]" && next === "]") depth--;
    if (c === "|" && depth === 0) {
      parts.push(cur);
      cur = "";
    } else {
      cur += c;
    }
  }
  parts.push(cur);
  const params: Record<string, string> = {};
  for (const p of parts.slice(1)) {
    const eq = p.indexOf("=");
    if (eq === -1) continue;
    params[p.slice(0, eq).trim().toLowerCase()] = p.slice(eq + 1).trim();
  }
  return params;
}

function parseGoalsParam(value: string, team: 1 | 2): ParsedGoal[] {
  const out: ParsedGoal[] = [];
  // Entries look like: *[[Alfredo Di Stéfano|Di Stéfano]] {{goal|27||30||73}}
  const entryRe = /\[\[([^|\]]+)(?:\|([^\]]*))?\]\]\s*((?:\{\{goal[\s\S]*?\}\}\s*)+)/gi;
  let m: RegExpExecArray | null;
  while ((m = entryRe.exec(value)) !== null) {
    const link = m[1].trim();
    const display = (m[2] ?? m[1]).trim();
    const goalTpls = m[3].match(/\{\{goal[\s\S]*?\}\}/gi) ?? [];
    for (const tpl of goalTpls) {
      const args = tpl
        .slice(2, -2)
        .split("|")
        .slice(1)
        .map((a) => a.trim());
      // args alternate: minute, annotation, minute, annotation...
      for (let i = 0; i < args.length; i += 2) {
        const minute = args[i];
        if (!minute) continue;
        const note = (args[i + 1] ?? "").toLowerCase();
        out.push({
          scorerLink: link,
          scorerDisplay: display,
          minute,
          penalty: note.includes("pen"),
          ownGoal: note.includes("o.g") || note.includes("og"),
          team,
        });
      }
    }
  }
  return out;
}

const LINEUP_ROW_RE =
  /^\|\s*([A-Z]{1,3})\s*\|\|\s*'{0,3}\s*(\d{1,2})?\s*'{0,3}\s*\|\|(.+)$/;

export function parseFinalPage(wikitext: string): ParsedFinalPage {
  const anomalies: string[] = [];
  const matches: ParsedMatch[] = [];

  // --- football boxes ---
  const boxRe = /\{\{\s*[Ff]ootball\s?box/g;
  let bm: RegExpExecArray | null;
  while ((bm = boxRe.exec(wikitext)) !== null) {
    const tpl = extractTemplate(wikitext, bm.index);
    if (!tpl) {
      anomalies.push("unclosed football box template");
      continue;
    }
    const p = templateParams(tpl);
    const t1 = p["team1"] ? firstLink(p["team1"]) : null;
    const t2 = p["team2"] ? firstLink(p["team2"]) : null;
    const scoreRaw = p["score"] ?? "";
    const scoreM = scoreRaw.match(/(\d+)\s*–\s*(\d+)/) ?? scoreRaw.match(/(\d+)\s*-\s*(\d+)/);
    const goals: ParsedGoal[] = [
      ...parseGoalsParam(p["goals1"] ?? "", 1),
      ...parseGoalsParam(p["goals2"] ?? "", 2),
    ];
    const penaltyM = (p["penaltyscore"] ?? "").match(/(\d+)\s*–\s*(\d+)/);
    matches.push({
      date: p["date"] ? stripMarkup(p["date"]) : null,
      team1Link: t1?.target ?? null,
      team2Link: t2?.target ?? null,
      score: scoreM ? `${scoreM[1]}–${scoreM[2]}` : null,
      extraTime: /aet|extra time/i.test(scoreRaw) || !!p["aet"] || !!penaltyM,
      penaltyScore: penaltyM ? `${penaltyM[1]}–${penaltyM[2]}` : null,
      stadium: p["stadium"] ? stripMarkup(p["stadium"]) : null,
      goals,
    });
  }
  if (matches.length === 0) anomalies.push("no football box found");

  // --- kit titles, to attribute lineup blocks to clubs ---
  interface KitMark {
    index: number;
    title: string;
  }
  const kits: KitMark[] = [];
  const kitRe = /\{\{\s*[Ff]ootball kit/g;
  let km: RegExpExecArray | null;
  while ((km = kitRe.exec(wikitext)) !== null) {
    const tpl = extractTemplate(wikitext, km.index);
    if (!tpl) continue;
    const p = templateParams(tpl);
    if (p["title"]) kits.push({ index: km.index, title: stripMarkup(p["title"]) });
  }

  // --- lineup rows ---
  const lines = wikitext.split("\n");
  let offset = 0;
  const lineOffsets: number[] = [];
  for (const l of lines) {
    lineOffsets.push(offset);
    offset += l.length + 1;
  }

  const blocks: LineupBlock[] = [];
  const blockStarts: number[] = []; // char offset of each block's first row
  let current: LineupBlock | null = null;
  let currentStart = 0;
  let inBench = false;

  const closeBlock = () => {
    if (current && current.players.length > 0) {
      blocks.push(current);
      blockStarts.push(currentStart);
    }
    current = null;
    inBench = false;
  };

  const kitsBefore = (offset: number) => kits.filter((k) => k.index < offset).length;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // wikitable close: a team's lineup table ended
    if (line.trim().startsWith("|}")) {
      closeBlock();
      continue;
    }
    if (/[Ss]ubstitutes:?\s*('''|<)?/.test(line) && line.startsWith("|") && /[Ss]ubstitutes/.test(line)) {
      if (current) inBench = true;
      continue;
    }
    if (/[Mm]anager:?/.test(line) && line.startsWith("|")) {
      if (current) {
        // manager name usually on this or the next non-empty cell line
        const here = firstLink(line) ?? firstLink(lines[i + 1] ?? "") ?? firstLink(lines[i + 2] ?? "");
        current.manager = here ? stripMarkup(here.display) : null;
        closeBlock();
      }
      continue;
    }

    const m = line.match(LINEUP_ROW_RE);
    if (!m) continue;
    const [, pos, shirtRaw, rest] = m;
    const lineStart = lineOffsets[i];
    // A kit template between the current block and this row means a new team
    // column began (modern interleaved layout without/before a Manager row).
    if (current !== null && kitsBefore(lineStart) > kitsBefore(currentStart)) {
      closeBlock();
    }
    // Pages without explicit Manager rows (some early finals): a fresh
    // starting GK after a full XI means a new team block is beginning.
    if (
      current !== null &&
      !inBench &&
      pos === "GK" &&
      (current as LineupBlock).players.filter((p) => p.isStarter).length >= 11
    ) {
      closeBlock();
    }
    if (!current) {
      current = { kitTitle: null, players: [], manager: null };
      currentStart = lineStart;
      inBench = false;
    }
    const link = firstLink(rest);
    const natM = rest.match(/\{\{(?:flagicon|fbaicon)\|([A-Za-z]{2,3})/);
    const captain = /\[\[Captain \(association football\)\|/.test(rest) || /\(c\)/.test(rest);
    const subOn = rest.match(/\{\{subon\|(\d+)/i);
    const subOff = rest.match(/\{\{suboff\|(\d+)/i);
    const displayName = link ? link.display : stripMarkup(rest);
    if (!displayName) continue;
    current.players.push({
      pos,
      shirt: shirtRaw ? parseInt(shirtRaw, 10) : null,
      nationality: natM ? natM[1].toUpperCase() : null,
      linkTarget: link?.target ?? null,
      displayName,
      captain,
      isStarter: !inBench,
      subOnMinute: subOn ? parseInt(subOn[1], 10) : null,
      subOffMinute: subOff ? parseInt(subOff[1], 10) : null,
    });
  }
  closeBlock();

  // Layout-aware kit pairing:
  //  - classic layout: both kits sit ABOVE all lineups -> pair by index order
  //  - interleaved layout: each kit precedes its own lineup -> nearest preceding
  // Segmented kit pairing. Final articles arrange kits + lineups as runs:
  // a run of kit templates followed by a run of lineup tables (one segment per
  // match for replayed finals; interleaved pages degenerate to 1-kit segments).
  // Within a segment, each full starting XI advances to the next kit; smaller
  // blocks (substitute tables) inherit the current team's kit.
  type Ev = { pos: number; kind: "kit"; title: string } | { pos: number; kind: "block"; idx: number };
  const events: Ev[] = [
    ...kits.map((k) => ({ pos: k.index, kind: "kit" as const, title: k.title })),
    ...blocks.map((b, i) => ({ pos: blockStarts[i], kind: "block" as const, idx: i })),
  ].sort((a, b) => a.pos - b.pos);
  let segKits: string[] = [];
  let collectingKits = true;
  let teamIdx = -1;
  for (const ev of events) {
    if (ev.kind === "kit") {
      if (!collectingKits) {
        segKits = [];
        teamIdx = -1;
        collectingKits = true;
      }
      segKits.push(ev.title);
    } else {
      collectingKits = false;
      const b = blocks[ev.idx];
      const startersN = b.players.filter((p) => p.isStarter).length;
      if (startersN >= 11 || teamIdx === -1) teamIdx++;
      b.kitTitle = segKits.length ? segKits[teamIdx % segKits.length] : null;
    }
  }

  if (blocks.length < 2) anomalies.push(`expected >=2 lineup blocks, found ${blocks.length}`);
  return { matches, lineups: blocks, kitTitles: kits.map((k) => k.title), anomalies };
}
