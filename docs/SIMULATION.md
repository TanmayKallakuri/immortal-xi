# Simulation Model (sim v1.0.0)

All randomness flows through `lib/rng.ts` (xmur3 + mulberry32), seeded from share-seed contents. **Same seed + same SIM_VERSION ⇒ identical campaign. Same two seeds + mode + SIM_VERSION ⇒ identical battle.** Any logic or tuning change bumps `SIM_VERSION` (`lib/simulation/version.ts`), and old seeds are rejected with an explicit message.

## Team strength (`lib/simulation/strength.ts`)

Per-slot player ratings are weighted by position fit (GK hard-gated to goal; adjacent-group penalties 0.85 / 0.7) and aggregated:

- **attack** — FW-weighted (FW 1.0 / MF 0.6 / DF 0.25)
- **control** — MF-weighted; **defense** — DF + GK weighted; **goalkeeping** — the keeper
- physical / clutch / aura — squad means

**Chemistry** (−10…+15): same club-season pairs (+2 each, the big one), same club across eras (+0.5), shared nationality, shared decade, balanced-shape bonus, −3 per severe position mismatch. Surfaced in the UI as scouting notes.

**Confidence** (mean of player data confidence) does not change strength — it widens match variance (deep-archive teams swing harder both ways).

## Match engine (`lib/simulation/engine.ts`)

- xG per side from a logistic comparison of (attack + 0.45·control + chemistry + aura trickle) vs (defense + 0.55·goalkeeping + chemistry): neutral baseline ≈ 1.35, clamped [0.15, 4.2]; home boost ×1.12.
- Goals drawn from a Poisson via the seeded stream; scorers weighted by player attack rating; events (goals, penalties, saves by elite keepers, late drama) build the timeline. Clutch-heavy sides skew goals later.
- Extra time = 0.34× xG period; then penalties: per-kick conversion from taker clutch vs keeper rating, 5 kicks + sudden death.

## Solo campaign (`lib/simulation/campaign.ts`)

Modern UCL structure:

1. **League phase** — your XI + 35 real historical club-seasons drawn deterministically into 4 strength pots (one season per club per field). You play 8 matches: home + away against each pot. Every other team's 8 results are simulated to build the full 36-row table (points, GD tiebreaks).
2. **Top 8** → round of 16. **9–24** → knockout play-off. **25–36** → eliminated.
3. **Knockouts** — two-legged ties (no away-goals rule; ET + penalties when level on aggregate), then a single neutral final with mandatory decision.
4. Outcomes: league-phase exit / play-off exit / R16 / QF / SF / runner-up / champion / **unbeaten champion** / **perfect campaign** — plus badges (`lib/simulation/badges.ts`).

Opponents are *real* club-seasons (a quarter-final against Milan 1988/89 means exactly that), with strength derived from progression (winner 86 / runner-up 82) or round reached in the 6,600-match results dataset, ±2 stable jitter. Your drafted players' own club-seasons are excluded from the field.

## Head-to-head (`lib/simulation/h2h.ts`)

Both seeds are reconstructed exactly (checksum + data/sim version validated), then battled in one of three modes:

- **one-off neutral final** (ET + pens)
- **two-legged tie** (A hosts leg 1; ET + pens at the end of leg 2 if level)
- **best-of-7 series** (every game decided; first to 4)

Output: aggregate, per-leg timelines, penalties where they happened, a 7-category tactical comparison, and a copyable battle result containing both seeds, the battle id and sim version — enough for anyone to reproduce it.

## Determinism rules (enforced by tests)

- No `Date.now()`, no `Math.random()` in any engine path.
- All iteration over collections is array-ordered or explicitly sorted before weighted draws.
- The campaign RNG root is derived from (SIM_VERSION, dataVersion, draftSeed, formation, all 11 picks); each phase forks a labeled substream, so adding a phase never disturbs earlier ones.
