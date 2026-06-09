# Rating Model (formula v1.0.0)

Ratings are **season-specific, deterministic, explainable, bounded [40, 99], and game-specific fiction**. They live in `lib/ratings/model.ts`; every computed rating stores its weighted parts as JSON in the `ratings` table.

## Inputs (all observed in canonical data)

| Input | Evidence source |
| --- | --- |
| role in the final (`starter` / `sub` / `bench`) | parsed lineup |
| club-season progression (`W` / `RU`) | finals list |
| goals in the final (+ penalty flags) | football box scorer templates |
| captaincy | lineup `(c)` markers |
| career finals + career final wins | player identity across all parsed finals |
| position group | lineup position codes (incl. WM-era: IR/OL/RH…) |
| season end year | season record |
| confidence score | pipeline (affects rarity + sim variance only) |

## Formula

```
base:      starter on winners 84 · starter RU 81 · sub 79/77 · bench 76/74
goalBonus: +2.5 per final goal (cap +5)
dynasty:   +1.2 per additional career final +0.8 per win (cap +6)
captain:   +1

overall  = clamp(base + goalBonus*0.6 + dynasty + captain)
attack   = position template over overall (+1.5 per final goal for MF/FW)
control  = position template (MF highest)
defense  = position template (DF highest)
physical = 70 + (overall-78)*0.5 (+3 DF/MF)
goalkeeping = GK: overall+2 · outfield: 20
clutch   = 65 + 6*finalGoals + 3*careerWins (+2 captain)
uclAura  = 60 + 5*careerFinals + 4*careerWins
rarity   = era base (1950s-60s: 80 … 2010s+: 45) + champion +5
           + low-confidence +5 + dynasty
```

## Era normalization — the core stance

A 1957 European Cup winner's starter and a 2024 winner's starter get the **same base**. Ratings express dominance within the player's own competitive context, projected onto one all-era fantasy scale. Older players are *not* penalized for sparse data:

- data scarcity → lower **confidence** → wider simulation variance + higher **rarity**
- data scarcity → **never** a lower rating

This is why a 1960 pick can feel risky and legendary at once — which is the game.

## Manual overrides

The formula only sees finals evidence, so it underrates players whose greatness lived elsewhere (Ballon d'Or seasons, five-final dynasties pre-dataset). Ten documented overrides for consensus legends (Di Stéfano, Puskás, Eusébio, Cruyff, Beckenbauer, Müller, Maldini, Zidane, Ronaldo, Messi) are stored in `data/overrides/ratings.json` with reasons citing public award records. Policy:

- overrides are absolute field values, clamped to [40, 99]
- stored separately from the formula; applied at export; flagged `overrideApplied`
- fully listed in the Data Room — no hidden magic

## Testing

`tests/ratings.test.ts` locks: determinism, bounds under extreme inputs, monotonicity (winners > losing bench, goals boost attack/clutch, dynasty boosts aura), era neutrality, and the confidence→rarity-not-quality rule. Export logs any rating outside bounds as `suspicious` (currently zero).

Changing any weight requires bumping `FORMULA_VERSION`, which changes the exported `dataVersion`, which invalidates old share seeds **loudly** (decode rejects with a version message).
