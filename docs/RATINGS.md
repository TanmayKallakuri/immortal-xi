# Rating Model (formula v3.0.0)

Ratings are **season-specific, deterministic, explainable, bounded [40, 99], and game-specific fiction**. The formula lives in `lib/ratings/model.ts`; every tunable weight lives in `lib/ratings/config.ts` — there are no magic constants in formula code. Every computed rating stores its weighted parts as JSON in the `ratings` table.

## The v3 redesign (why v2 was wrong)

v2 fixed the career-reputation leak, but squad-list teams (curated iconic non-finalists) still rated almost everyone at the flat tier base: Monaco 2016/17 shipped as 28 players all at 77 — Mbappé's breakout season indistinguishable from a third-choice keeper. Two causes:

1. **The pipeline discarded the evidence.** Most club-season articles keep a separate "Appearances and goals" statistics section; the parser only read the squad list and threw the stats rows away. v3 merges `{{Efs player}}` / `{{Efs player2}}` stats from anywhere on the page into the squad by wikilink identity, maps the European and domestic league columns **by the competition names in `{{Efs start}}`**, extracts starts vs sub appearances, and treats an all-zero European column as unreliable instead of as evidence.
2. **The formula had no position-specific impact model.** v3 computes a player-season impact score: involvement + position-weighted production + knockout impact + capped domestic context.

## Formula sketch

```
contextBase: starter 84/81 (W/RU) · sub 77.5/75.5 · bench 74/72.5
             squad-list teams by tier: SF 73 · QF 72 · R16 71 · GS 70 · PART 69
             (the ONLY team-achievement input; W-vs-RU spread capped at 4)

involvement: European apps tiers  10+ → +5 · 8+ → +4 · 6+ → +2.5 · 4+ → +1.5
                                  2-3 → −1.5 · 1 → −4 · 0 → −6
             +1 if a true starter (8+ starts AND starts/apps ≥ 0.7)
             thresholds ×0.6 before 1992 (the pre-group era was ~9 matches, not ~15)
             null apps = no evidence = 0 — UNLESS the squad's stats table exists,
             then a missing row means "did not feature in Europe" (−5, flagged)

production:  European goals, position-specific:
             FW ×1.0 (cap 6) · MF ×0.85 (cap 5) · DF ×0.5 (cap 2.5) · GK 0
             +1 inside the cap for an elite rate (4+ goals at ≥0.5 per app, FW/MF)

knockout:    min(4.5, finalGoals × 1.5)   (lineup-evidence teams)

domestic:    same-season league context, capped at 2.5 total:
             goals ×0.15 FW / ×0.12 MF / ×0.05 DF (cap 2) + regular-starter bonus
             (this is what lifts a breakout season when the European sample is
             small — never career reputation)

overall   = clamp(contextBase + involvement + production + knockout + domestic + captain 1)
uclAura   = clamp(min(96, 58 + careerFinals×4 + careerWins×3))   // career lives HERE
clutch    = 64 + finalGoals×6 + min(8, contGoals×1.2) + captain 2
            + champion 3 / deep-run 1.5 + min(4, extra career finals)
attack/control/defense/physical/goalkeeping = position templates over overall
            (+ goal-driven attack bonuses; DF/GK core-involvement defense bonus)
rarity    = era base (50s-60s 80 … 2010s+ 45) + champion +5 + deep-archive +8 + cult +6
```

Lineup-evidence roles (starter/sub/bench) already encode involvement in their base, so their (rare) continental stats count at half weight (`FINALIST_SEASON_EVIDENCE_SCALE`).

## Calibration (Monaco 2016/17, all from the global model — no hardcodes)

| Player | Evidence | Overall |
| --- | --- | --- |
| Falcao | 10 UCL apps, 7 UCL goals, 21 league goals | 87.5 |
| Mbappé | 9 UCL apps (6 starts), 6 UCL goals, 15 league goals | 85.5 |
| Bernardo Silva | 15 apps, 3 goals, ever-present | 83.5 |
| Glik / Sidibé / Jemerson | core defenders, 12-15 apps | 80-81 |
| Subašić | starting GK, 14 apps | 80 |
| Moutinho / Dirar | rotation | 78.6-79.2 |
| De Sanctis | backup GK, 2 apps | 71.5 |
| reserves / youth | 0-1 apps or absent from the stats table | 67-69 |

## Inputs (all observed in canonical data)

| Input | Evidence source | Feeds |
| --- | --- | --- |
| role in the final (`starter`/`sub`/`bench`) | parsed final lineup | context base |
| squad membership (`squad` role) + team tier | club-season article squad list | context base |
| goals in that season's final | football box scorer templates | overall, attack, clutch |
| European apps + starts + goals that season | `{{Efs player}}`/`{{Efs player2}}` stats tables | involvement, production, attack, clutch |
| league apps + goals that same season | the named league column of the same tables | capped domestic context |
| captaincy | lineup `(c)` markers | overall (+1), clutch |
| career finals / wins | player identity across parsed finals | **ucl_aura only** (+ capped clutch crumb) |
| position group | lineup/squad position codes | subrating templates, production weights |
| season end year | season record | rarity + involvement era-scaling |
| confidence score | pipeline | rarity + sim variance + uncertainty band |

## Era normalization

A 1957 winner's starter and a 2024 winner's starter share the same base. Involvement thresholds scale to era competition length. Data scarcity lowers **confidence** (wider simulation variance, higher rarity, an explicit `uncertaintyBand` in the explanation) — never the rating. Old players are risky and legendary, not bad.

## The global rating audit

`npm run rating-audit` (part of `npm run pipeline`) scans every exported player-season for the whole bug class, not individual examples:

- **weak-evidence-high** — bench/sub/squad players ≥ 86 without strong season evidence or overrides
- **defender-over-scorer** — a defender with no stronger involvement outranking a meaningful scorer of the same club-season and role
- **context-overweight** — overall above context base + personal-evidence cap (only documented overrides may; listed)
- **flat-squad** — a squad WITH per-player stats whose ratings still cluster (HIGH); squads WITHOUT stats are listed as info data gaps
- **star-not-separated** / **fringe-high** / **backup-gk-near-starter** / **breakout-stuck**
- **identical-across-seasons** / **low-confidence-extreme** / **era-extreme**
- **monaco-regression** — sentinels on the club-season that exposed the bug class: Mbappé in the 82-88 star band and clear of the squad median, Falcao ≥ 84, squad spread ≥ 12, reserves ≤ 74

The audit exits non-zero on any HIGH finding. Current state: 0 high findings; info entries = the documented legend overrides + the squads whose pages carry no machine-readable stats (named in the report as data gaps).

## Manual overrides

Ten documented overrides for consensus legends (Di Stéfano, Puskás, Cruyff, …) live in `data/overrides/ratings.json` with reason/source-note/date. They are applied at export, flagged `overrideApplied`, surfaced in the Data Room and in the audit. Policy unchanged: absolute values, clamped, never hidden in formula code.

## Tests

`tests/ratings.test.ts` locks: determinism, bounds under extremes, the career-firewall, the team-context cap, the squad-player ceiling, decisive-loser ≥ quiet-winner, season-specificity, position-specific production, the breakout band, starts-ratio gating, the domestic cap, statted-squad absence handling, era-scaled involvement, era neutrality, confidence→rarity-not-quality, and override clamping. `tests/ratings-data.test.ts` re-asserts the Monaco 2016/17 spread on the live export. Changing any weight requires bumping `FORMULA_VERSION`, which changes `dataVersion` and invalidates old seeds loudly.
