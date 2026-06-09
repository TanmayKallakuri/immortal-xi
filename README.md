# Immortal XI

**Draft the team history never allowed. Then find out if it could actually win the thing.**

Immortal XI is a browser game built on the full history of the European Cup and UEFA Champions League, 1955/56 to today. Eleven spins of the archive each land on a real club-season — Reims 1956, Celtic 1967, Steaua 1986, Ajax 1995, PSG 2025 — and you take exactly one player from that actual squad. When your eleven is signed, the engine throws them into a full modern-format Champions League campaign: 36-team league phase, knockout play-off, two-legged ties, a one-night final. Extra time. Penalties. Heartbreak or immortality.

Every finished team produces a **share seed** — a short string that reconstructs your exact XI and replays your exact campaign on anyone's machine. Paste two seeds into **Head-to-Head** and settle whose immortals are better: one-off final, two-legged tie, or a best-of-7 fantasy series. Same seeds, same mode, same result, every time. No arguments — well, fewer arguments.

## What it feels like

- The reel lands on **Real Madrid 1959/60** and you have to choose between Di Stéfano, Puskás and Gento — knowing you can probably never pick the other two again.
- It lands on **Malmö FF 1979** and you grin, because four cult-club picks unlock the *Underdog Collector* badge and a giant-killer story.
- It lands on **Real Madrid 2016/17** when you already have Gento, and suddenly two eras of the same club share a dressing room (*Same-Club Era Collision* — rare by design).
- Your back line is 1960s, your midfield is 1990s, your striker is from last season — and the league phase doesn't care. Survive it or go home.

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
| `npm run pipeline` | all four pipeline stages in order |

## How it stays honest

- **Real data only.** Finals, scores, lineups and scorers are parsed from cited public sources; 6,600+ real match results give the opponent pool its strength bands. Nothing historical is fabricated — gaps become visible quality flags, not invented facts.
- **Explainable ratings.** Every rating is computed from observed evidence (role in the final, goals, captaincy, career finals) with the formula in version-controlled code. The handful of manual overrides for consensus legends are stored separately with reasons and dates, and displayed openly in the **Data Room**.
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
