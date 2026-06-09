# Product, Design & Engineering Decisions

## Product

- **Club-season is the draft unit**, not the club. Real Madrid 1959/60 and 2016/17 are different cards. Same-club/different-era collisions are possible but rare: after a club appears once, all its other seasons are weighted ×0.22; after twice, excluded. The same exact club-season can never be spun twice in a draft, and the same player (across any of their seasons) can never be picked twice.
- **No rerolls.** The archive gives what it gives — scarcity creates the stories. (A bounded reroll currency was considered and rejected: it flattens the drama and breaks "same key, same spins" sharing.)
- **Draft pool = finalist squads (142 club-seasons, every final 1956→2026).** This is the largest body of full, position-coded, per-season lineups that can be parsed from consistent public sources without fabrication. Semi-finalist squads are the documented next extension; the 2,660-club-season opponent pool already exceeds the draft pool by design.
- **Spin weighting fights superclub fatigue**: era-coverage boost (×1.5 for undrafted decades), cult-club bonus (≤2 finals: ×1.25), superclub damping (≥10 finals: ×0.75), winner significance ×1.15, confidence and squad-completeness multipliers. Famous clubs still appear often because they have many great seasons — never through favoritism.
- **Share seeds are the social object.** Compact (`IX1.<data>.<sim>.<formation>.<key>.<picks>.<crc>`), checksummed, version-pinned, and reconstructable. The result URL is itself a proof: it re-simulates rather than storing an outcome.

## Design

- **Aesthetic: "Midnight Archive"** — 1960s European match-programme (chalk cream serif, brass foil rules, dashed ticket edges, grain) crossed with modern broadcast data graphics (mono numerals, rating bars, pot tables). Dark by default; gold is reserved for glory states.
- Typography: Fraunces (display serif with optical sizing) + IBM Plex Mono (data). Deliberately not Inter-on-dark-blue.
- Original identity only: no UEFA marks, crests, or photos; the crown glyph and pitch geometry are hand-drawn SVG.
- Accessibility: keyboard-operable draft (all interactions are real buttons with `aria-pressed`/`aria-expanded`), visible focus rings, status conveyed by text + icon rather than color alone, truncation with full text in titles.

## Engineering

- **Stack:** Next.js 15 (App Router, static pages), TypeScript strict, Tailwind v4, better-sqlite3 + Drizzle for the pipeline DB, Zod at the data boundary, Vitest + a process-spawning HTTP smoke test.
- **Engines are pure TS modules** shared by UI, scripts and tests — the browser simulates locally from `public/game-data.json` (~2 MB), so results pages need no server and deploy statically.
- **DDL bootstrap instead of drizzle-kit migrations**: the canonical DB is a rebuildable artifact of `npm run clean`, not a stateful store; migrations would be ceremony without benefit. The schema stays Postgres-compatible for a future hosted variant.
- **`draft_seeds` / `h2h_battles` tables exist but are unused by the static deployment** — seeds are self-contained by design; the tables document the schema for self-hosted persistence.
- **Wikipedia parsing strategy:** wikitext (not HTML) via the MediaWiki API; brace-matching template extraction; segmented kit-to-lineup pairing that survived every layout 1956–2026 (classic side-by-side kits, interleaved modern pages, the 1974 replay double-final). Every deviation becomes a flag, and parser fixes are validated by re-running `npm run clean` against preserved raw payloads.
- **E2E approach:** engine-level full flow (draft → seed → campaign → H2H) plus HTTP checks of every screen on the production build. A browser-automation layer (Playwright) was considered and deferred — the interactive flow is engine-driven, and the engine path is covered end-to-end.

## Known limitations

1. Draftable squads are finalists only (~16 players per squad on average; 1950s finals list 11–12). Semi-finalist lineups would roughly double the pool.
2. Per-season statistics beyond the final itself (campaign goals, appearances) are not yet ingested; ratings lean on finals evidence + documented overrides.
3. Six 1950s players have name-only identity (no Wikipedia article) — flagged for review.
4. Synthetic league-table results for the other 35 teams use a faster model than your matches (full event simulation for all 144 fixtures would add nothing visible).
5. The 2025/26 squad data follows whatever Wikipedia's final article contains at ingest time; re-run `npm run ingest` after major updates.

## Execution log (what was actually built and verified)

- Live ingest: 71 finals list rows, 71/71 final pages, 61/61 footballcsv seasons; UEFA/Kaggle/FBref registered + blocked with reasons.
- Canonical: 71 seasons, 500 clubs, 2,660 club-seasons (142 squad-complete finalists — 100%), 1,518 players, 2,287 player-seasons, 6,624 matches, 188 final goals, zero error-severity flags after parser hardening.
- All unit tests and the full E2E smoke pass against the production build.
