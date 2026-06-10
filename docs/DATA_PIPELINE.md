# Data Pipeline

## Architecture: three layers, one direction

```
┌─────────────────────────────────────────────────────────────────┐
│ RAW LAYER            data/raw/<source>/<key>.json               │
│ verbatim payloads + provenance (url, retrievedAt, parser ver)   │
│ append-only: clean/export never write here                      │
└──────────────────────────────┬──────────────────────────────────┘
                               │ npm run clean (scripts/clean)
┌──────────────────────────────▼──────────────────────────────────┐
│ CANONICAL LAYER      data/immortal.db (SQLite via Drizzle)      │
│ competitions seasons rounds clubs club_aliases club_seasons     │
│ players player_aliases player_seasons squads matches            │
│ appearances goals positions ratings sources source_records     │
│ data_quality_flags manual_overrides simulation_versions        │
│ fully rebuildable from RAW at any time                          │
└──────────────────────────────┬──────────────────────────────────┘
                               │ npm run export-game-data
┌──────────────────────────────▼──────────────────────────────────┐
│ GAME LAYER           public/game-data.json                      │
│ only validated, rated, draft-ready records + source summaries   │
│ stamped with a content-hash dataVersion                         │
└─────────────────────────────────────────────────────────────────┘
```

Principles:

- **Never overwrite raw data.** Re-running ingest refreshes payloads; clean and export only read.
- **Every record carries provenance** — source record id, retrieval date, parser version.
- **Never fabricate.** Anything missing or ambiguous becomes a `data_quality_flags` row and, where relevant, lowers a confidence score. The parser guesses nothing.
- **Idempotent rebuilds.** `npm run clean` wipes and rebuilds the canonical layer deterministically from raw.

## Sources

| Source | Status | What we take | License note |
| --- | --- | --- | --- |
| Wikipedia finals list | ok | every final 1956→latest: season, finalists, score, venue, attendance | CC BY-SA; factual records |
| Wikipedia final articles (~71 pages) | ok | full lineups (positions, shirt numbers, captains, subs), scorers + minutes, match details | CC BY-SA; factual records |
| Wikipedia club-season articles (20 pages, curated) | ok | first-team squads for iconic non-finalists; per-player European apps/goals where the article's `{{Efs player}}` stats table carries them | CC BY-SA; factual records |
| footballcsv (europe-champions-league) | ok | 61 seasons of complete match results → opponent pool + round-reached categories | public domain (CC0) |
| UEFA.com | **blocked** | — (JS-rendered, restrictive terms; manual cross-check only) | proprietary |
| Kaggle datasets | **blocked** | — (requires authenticated API) | per-dataset |
| FBref | **blocked** | — (terms restrict automated scraping; skipped by policy) | proprietary |

Blocked sources stay registered in the `sources` table with a reason and appear in the Data Room — the ingestion framework treats unavailability as a visible state, not an error to hide.

## Entity resolution

- **Club-season is the core unit.** `cs-real-madrid-1959-60` and `cs-real-madrid-2016-17` are distinct draftable entities; `real-madrid` is one canonical club with aliases ("Real Madrid CF", "Real Madrid C.F.", …) preserved per source.
- **Players are identified by Wikipedia article title** (unique per person), so "Marquitos (footballer, born 1933)" stays distinct from any other Marquitos, while Cristiano Ronaldo 2008 and 2017 unify into one `player_id` with per-season `player_season` rows. Players without an article fall back to a name key and are flagged (`name-only-identity`).
- **Curated alias map** covers every EC/UCL finalist club (including renamed clubs: Steaua/FCSB, Crvena zvezda/Red Star); unknown clubs canonicalize via generic cleaning and are flagged `club-fallback-normalization`.

## Confidence scoring

Every club-season and player-season gets `confidence_score` (0–1) + label:

- club-season: source confidence → +squad parsed → +11 starters & GK present → +parse anomaly-free (max 0.92)
- player-season: club-season confidence × identity evidence (wikilink 1.0 / name-only 0.8) × position-code certainty

Confidence **never lowers a rating** — it widens simulation variance and raises card rarity (see RATINGS.md), and routes records into the review queue.

## Quality flags you'll see

`missing-squad`, `starter-count`, `missing-goalkeeper`, `duplicate-in-squad`, `duplicate-candidate`, `impossible-squad` (>30 parsed), `position-inferred`, `name-only-identity`, `parse-anomaly`, `scorer-not-in-squad`, `lineup-attributed-by-order`, `club-fallback-normalization`, `override-target-missing`. The report (`npm run data-quality-report`) aggregates them and prints the recommended cleanup queue.

## Categories + curation

Every club-season carries a `category` (and optional `tags`):

- **derived**: `champion` / `runner_up` from the finals list; `semi_finalist` / `quarter_finalist` / `round_of_16` / `group_stage` / `participant` from round reached in match data
- **curated**: `data/curation/iconic-club-seasons.json` overrides categories and adds tags (`upset_team`, `cult_team`, `high_xg_or_eye_test_team`, `historic_giant_killer`, `domestic_legend_in_europe`, `collapse_iconic`, `data_incomplete_but_iconic`) and, for non-finalists, names the Wikipedia club-season article whose squad list to ingest

**Adding an iconic team** is one JSON entry + `npm run pipeline`. Three squad-template families are parsed (`{{fs player}}`, `{{Efs player}}` incl. European stat columns, `{{fb si player}}`); reserve/loan/transfer sections are cut off; unparseable pages leave the team category-only and visibly flagged (e.g. Leeds 2000/01 uses a bare wikitable and is the one shipped entry without a squad).

## Adding a new source

1. Register it in `SOURCE_DEFS` (`scripts/ingest/framework.ts`) with license/redistribution notes.
2. Fetch in `scripts/ingest/run.ts` via `fetchText`/`fetchWikitext` and persist with `saveRaw` — never parse during ingest beyond what's needed to discover further pages.
3. Parse in `scripts/clean/` into canonical rows; emit `data_quality_flags` for everything unexpected.
4. If it can fail (auth, terms, availability), wrap it so failure marks the source `blocked` with a reason and the run continues.

## Manual overrides

`data/overrides/ratings.json` — an array of `{ playerSeasonId, fields, reason, authorNote, date }`. They are loaded into the `manual_overrides` table at clean time, applied on top of the computed formula at export time, marked `overrideApplied` on the exported record, and listed verbatim in the Data Room. An override that targets a non-existent player-season is flagged, not silently dropped.

## Regenerating everything

```bash
npm run pipeline
# = ingest (reuses existing raw payloads) -> clean -> export-game-data -> data-quality-report
```

Force a fresh ingest by deleting `data/raw/<source>/` for the sources you want refetched.
