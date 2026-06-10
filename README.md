# Immortal XI

**Draft the team history never allowed. Then find out if it could actually win the thing.**

Immortal XI is a browser game built on the full history of the European Cup and UEFA Champions League, 1955/56 to today. Eleven spins of the archive each land on a real club-season — Reims 1956, Celtic 1967, Steaua 1986, Deportivo 2004, Ajax 2019 — and you take exactly one player from that actual squad. You never know how a team finished that season until your eleven is signed (and in **Hard Mode** you don't even see ratings — just names, positions and your own football memory). Then the engine throws your XI into a full modern-format Champions League campaign, revealed **one match at a time**: 36-team league phase, knockout play-off, two-legged ties, a one-night final. Extra time. Penalties. Heartbreak or immortality.

Every finished team gets a **6-character share code** (plus a portable full seed) that reconstructs your exact XI and replays your exact campaign. Paste two codes into **Head-to-Head** and settle whose immortals are better: one-off final, two-legged tie, or a best-of-7 fantasy series. Same seeds, same mode, same result, every time. No arguments — well, fewer arguments.

## What it feels like

- The archive flips past a dozen ghosts and lands on **Real Madrid 1959/60** — Di Stéfano, Puskás or Gento, knowing you can probably never pick the other two again.
- It lands on **Deportivo 2003/04** or **APOEL 2011/12** and you grin, because the pool isn't just champions anymore — semi-finalists, quarter-finalists, cult teams and iconic collapses are all in the reel, and four cult-club picks unlock the *Underdog Collector* badge.
- In **Hard Mode** it lands on **Dynamo Kyiv 1998/99** and there are no numbers to hide behind. You either know who Shevchenko's strike partner was, or you don't.
- Your campaign unfolds match by match — a 94th-minute equalizer in leg two, aggregate level, extra time, penalties — and nobody told you the ending in advance. Survive it or go home.

## Quick start

```bash
npm install
npm run pipeline   # ingest -> clean -> export -> quality report (fetches real sources)
npm run dev        # open http://localhost:3000
```

The repo ships without data by design — `npm run pipeline` builds the dataset from live public sources and prints a full data-quality report when it's done. Already-fetched raw payloads are reused on re-runs.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | development server |
| `npm run build` / `npm start` | production build / serve |
| `npm test` | unit tests (engines, parsers, identity, determinism) |
| `npm run test:e2e` | end-to-end smoke: full draft → campaign → H2H → every screen over HTTP (build first) |
| `npm run ingest` | fetch raw payloads from all registered sources (blocked sources are logged, never faked) |
| `npm run clean` | derive the canonical layer: clubs, players, squads, matches, flags |
| `npm run export-game-data` | compute ratings + write `public/game-data.json` |
| `npm run data-quality-report` | regenerate the data room report |
| `npm run rating-audit` | global audit for structurally suspicious ratings (fails on HIGH findings) |
| `npm run pipeline` | all five pipeline stages in order |

## How it stays honest

- **Real data only.** Finals, scores, lineups, scorers and squad lists are parsed from cited public sources; 6,600+ real match results give the opponent pool its strength bands; curated iconic teams (Ajax 2019, Monaco 2017, Roma 2018, …) come with their actual Wikipedia squad lists — several with per-player European appearance and goal stats. Nothing historical is fabricated — gaps become visible quality flags, not invented facts.
- **Explainable, season-honest ratings.** Every rating is computed from that player-season's observed evidence (role in the final, goals, that season's European apps where sourced) with all weights in one config file. Career trophy counts cannot inflate a season's overall — they live in aura, capped — and a global audit script hunts the "squad player outranks the star" bug class on every pipeline run. Manual overrides for consensus legends are stored separately with reasons and dates, displayed openly in the **Data Room**.
- **Deterministic everything.** Drafts, campaigns and battles are seeded simulations. Seeds carry data + simulation versions and a checksum; incompatible or edited seeds are rejected with a clear message instead of replaying wrong.
- **No borrowed identity.** No UEFA branding, no club crests, no player photos. The look is original: midnight archive, chalk serif, brass foil.

## Documentation

| Doc | Contents |
| --- | --- |
| [docs/DATA_PIPELINE.md](docs/DATA_PIPELINE.md) | three-layer architecture, sources, adding a source, overrides, regeneration |
| [docs/RATINGS.md](docs/RATINGS.md) | the rating formula, era normalization, override policy |
| [docs/SIMULATION.md](docs/SIMULATION.md) | match model, campaign structure, H2H modes, determinism rules |
| [docs/DECISIONS.md](docs/DECISIONS.md) | product/design/engineering decisions and known limitations |

## Stack

TypeScript · Next.js 15 · Tailwind v4 · SQLite (better-sqlite3) + Drizzle for the data pipeline · Zod · Vitest.

---

*Unofficial fan project. No affiliation with UEFA, any club, or any player. Ratings are game-specific fiction derived from public historical records.*
