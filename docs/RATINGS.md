# Rating Model (formula v2.0.0)

Ratings are **season-specific, deterministic, explainable, bounded [40, 99], and game-specific fiction**. The formula lives in `lib/ratings/model.ts`; every tunable weight lives in `lib/ratings/config.ts` — there are no magic constants in formula code. Every computed rating stores its weighted parts as JSON in the `ratings` table.

## The v2 redesign (why v1 was wrong)

v1 added a "dynasty bonus" (career finals × weight) directly to a player-season's **overall**. That is exactly the bug class where a support player from a dominant multi-final team outranks a decisive star: career-level team achievement leaked into a season rating. v2 removes the entire class:

- **Career inputs cannot touch overall.** `careerFinals` / `careerFinalWins` feed `ucl_aura` (and a tiny capped clutch term) only. A test locks `overall(careerFinals=1) === overall(careerFinals=8)`.
- **Team achievement is capped.** The only team input to overall is the context base tier; the W-vs-RU spread is ≤ `TEAM_CONTEXT_SPREAD_CAP` (4), test-enforced per role.
- **Squad players cannot reach 90+** without personal evidence, however good their team — test-enforced across roles × tiers.
- **Personal evidence first.** Goals in that season's final, captaincy that day, and (where the source provides it) that season's European appearances and goals are what separate players.

## Inputs (all observed in canonical data)

| Input | Evidence source | Feeds |
| --- | --- | --- |
| role in the final (`starter`/`sub`/`bench`) | parsed final lineup | context base |
| squad membership (`squad` role) + team tier (SF/QF/R16/GS) | club-season article squad list | context base |
| goals in that season's final | football box scorer templates | overall, attack, clutch |
| European apps + goals that season | `{{Efs player}}` stats tables (where present) | overall (core/rotation/fringe adj, goal bonus), attack, clutch |
| captaincy | lineup `(c)` markers | overall (+1), clutch |
| career finals / wins | player identity across parsed finals | **ucl_aura only** (+ capped clutch crumb) |
| position group | lineup/squad position codes | subrating templates |
| season end year | season record | rarity only |
| confidence score | pipeline | rarity + sim variance only |

## Formula sketch

```
contextBase: starter 84/81 (W/RU) · sub 78/76 · bench 75/73
             squad-list teams by tier: SF 77 · QF 75 · R16 73 · GS 72 · PART 71
overall  = clamp(contextBase
                 + min(4.5, finalGoals*1.5)
                 + min(5, continentalGoals*0.8)
                 + apps tier adj (core +2 / rotation +1 / fringe -2.5)
                 + captain 1)
uclAura  = clamp(min(96, 58 + careerFinals*4 + careerWins*3))   // career lives HERE
clutch   = 64 + finalGoals*6 + min(8, contGoals*1.2) + captain 2 + champion 3 + min(4, extra finals)
attack/control/defense/physical/goalkeeping = position templates over overall
rarity   = era base (50s-60s 80 … 2010s+ 45) + champion +5 + deep-archive +8 + cult tags +6
```

## Era normalization

A 1957 winner's starter and a 2024 winner's starter share the same base. Data scarcity lowers **confidence** (wider simulation variance, higher rarity) — never the rating. Old players are risky and legendary, not bad.

## The global rating audit

`npm run rating-audit` (part of `npm run pipeline`) scans every exported player-season for the whole bug class, not individual examples:

- **weak-evidence-high** — bench/sub/squad players ≥ 86 without overrides
- **defender-over-scorer** — a defender outranking a goal-scoring attacker of the same club-season and role
- **context-overweight** — overall above context base + personal-evidence cap (only documented overrides may do this; they are listed)
- **identical-across-seasons** — same player, same overall, different season evidence
- **low-confidence-extreme** / **era-extreme**

The audit exits non-zero on any HIGH finding. Current state: 0 high findings; 7 info entries = the documented legend overrides.

## Manual overrides

Ten documented overrides for consensus legends (Di Stéfano, Puskás, Cruyff, …) live in `data/overrides/ratings.json` with reason/source-note/date. They are applied at export, flagged `overrideApplied`, surfaced in the Data Room and in the audit. Policy unchanged from v1: absolute values, clamped, never hidden in formula code.

## Tests

`tests/ratings.test.ts` locks: determinism, bounds under extremes, the career-firewall, the team-context cap, the squad-player ceiling, decisive-loser ≥ quiet-winner, season-specificity, continental core-vs-fringe separation, era neutrality, confidence→rarity-not-quality, and override clamping. Changing any weight requires bumping `FORMULA_VERSION`, which changes `dataVersion` and invalidates old seeds loudly.
