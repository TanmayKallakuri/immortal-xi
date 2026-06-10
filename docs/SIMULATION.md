# Simulation Model (sim v4.0.0)

> v4.0.0: stage-aware knockout opponent draw from the full historical pool (QF/SF/final escalate toward elite champions/finalists), evidence-blended teamStrength scale, opponent sides take positional shape from their real squads, ratings formula v3 — all team strengths changed, so v3 seeds are rejected with a version message.

All randomness flows through `lib/rng.ts` (xmur3 + mulberry32), seeded from share-seed contents. **Same seed + same SIM_VERSION ⇒ identical campaign. Same two seeds + mode + SIM_VERSION ⇒ identical battle.** Any logic or tuning change bumps `SIM_VERSION` (`lib/simulation/version.ts`), and old seeds are rejected with an explicit message.

## Team strength (`lib/simulation/strength.ts`)

Per-slot player ratings are weighted by position fit and aggregated. Fits come from the slot-class system in `lib/draft/formations.ts` (GK hard-gated both ways; fit 0 = ineligible):

- **attack** — FW-weighted (FW 1.0 / MF 0.6 / DF 0.25)
- **control** — MF-weighted; **defense** — DF + GK weighted; **goalkeeping** — the keeper
- physical / clutch / aura — squad means

**Chemistry** (−10…+15): same club-season pairs (+2 each, the big one), same club across eras (+0.5), shared nationality, shared decade, balanced-shape bonus, −3 per severe position mismatch.

**Confidence** (mean of player data confidence) does not change strength — it widens match variance (deep-archive teams swing harder both ways).

## Opponent strength model

Every opponent club-season carries a `teamStrength` (60-96) computed at export:

- **category base** (historical tier): champion 88 · runner-up 84 · semi-finalist 80 · quarter-finalist 76 · R16 73 · iconic group-stage 72 · group-stage 70 · participant 66
- **squad-evidence quality**: the squad's top-11 average overall compared with the AVERAGE squad of its own category, ±(−3…+6) — a stacked champion (Bayern '74, Barça '11, Madrid '60) separates from an ordinary one without era bias
- eye-test tag +2, stable ±2 jitter; clamped [60, 96]

Champions land 86-93, runners-up 82-88, deep runs below — so "best ever" reads as best ever.

**Scale calibration:** the user's XI profile compresses (positional weighting + slot fits put even an all-legend XI in the low/mid 80s), so opponent sides map teamStrength onto the profile scale via `opponentProfileBase` (66 + 0.66·(s−66)) — an elite final opponent matches a world-class drafted XI; a pot-4 minnow is genuinely beatable. Where a real squad exists, the side takes **positional shape** from its actual players (re-centered ±4), and champions get aura/clutch bumps. No user-side modifiers exist anywhere — difficulty is opponent quality only.

## Match engine (`lib/simulation/engine.ts`)

- xG per side from a logistic comparison of (attack + 0.45·control + chemistry + aura trickle) vs (defense + 0.55·goalkeeping + chemistry): neutral baseline ≈ 1.35, clamped [0.15, 4.2]; home boost ×1.12.
- Goals drawn from a Poisson via the seeded stream; scorers weighted by player attack rating; assists weighted by control+attack; events build the timeline. Clutch-heavy sides skew goals later.
- Extra time = 0.34× xG period; then penalties: per-kick conversion from taker clutch vs keeper rating, 5 kicks + sudden death.

## Solo campaign (`lib/simulation/campaign.ts`)

Modern UCL structure:

1. **League phase** — your XI + 35 real historical club-seasons drawn deterministically into 4 banded pots (`LEAGUE_POT_BANDS`: 84-96 / 78-85 / 72-79 / 60-75 — a broad mix from elites to minnows, one season per club). You play 8 matches: home + away against each pot. Every other team's 8 results are simulated to build the full 36-row table.
2. **Top 8** → round of 16. **9–24** → knockout play-off. **25–36** → eliminated.
3. **Knockouts — stage-aware draw from the FULL pool** (`STAGE_BANDS`): each round draws a real club-season by weighted randomness centered on the stage's target strength, with champions/finalists weighted up progressively (`STAGE_ELITE_FACTOR`):

   | round | band | target | feel |
   | --- | --- | --- | --- |
   | play-off | 74-84 | 79 | medium-strong |
   | R16 | 78-88 | 83 | strong |
   | QF | 82-91 | 87 | top-8-of-Europe |
   | SF | 85-93 | 89 | elite |
   | final | 88-95 | 92 | monster |

   Excluded: the user's drafted club-seasons, clubs already faced this campaign, and field teams eliminated in the league phase. Constraints relax (band first, then club repeats) only if the pool starves — same-club different-era collisions are rare but possible. Squad-complete teams and data confidence weight up; eras already faced weight down for variety.
4. Outcomes: league-phase exit / play-off exit / R16 / QF / SF / runner-up / champion / **unbeaten champion** / **perfect campaign** — plus badges.

Every played match and tie records `opponentClubSeasonId` and `opponentStrength` for auditability.

## The simulation audit

`npm run sim-audit` (part of `npm run pipeline`) simulates ~84 campaigns across three cohorts (auto-drafted XIs, a best-available "monster" XI, a ~78-overall "average" XI) and **fails** unless:

- average opponent strength escalates league → R16 → QF → SF → final, with the final the hardest
- knockout opponents stay within their stage bands (tolerance for relaxed draws)
- no drafted club-season ever appears as an opponent; no club is faced twice in one campaign
- the monster XI still wins titles (no hidden nerf) and the average XI fares worse
- final opponents vary across seeds

Current state (sim 4.0.0): league avg ~77 → playoff ~77 → R16 ~83 → QF ~86 → SF ~89 → final ~89-92 (hardest); monster XI ~7% titles + ~17% finals; average XI never past the QF.

## Head-to-head (`lib/simulation/h2h.ts`)

Both seeds are reconstructed exactly (checksum + data/sim version validated), then battled in one of three modes: one-off neutral final, two-legged tie, best-of-7. Output: aggregate, per-leg timelines, penalties where they happened, a 7-category tactical comparison, and a copyable battle result.

## Determinism rules (enforced by tests)

- No `Date.now()`, no `Math.random()` in any engine path.
- All iteration over collections is array-ordered or explicitly sorted before weighted draws.
- The campaign RNG root is derived from (SIM_VERSION, dataVersion, draftSeed, formation, all 11 picks); each phase forks a labeled substream (knockout draws fork `ko-draw-<round>`), so adding a phase never disturbs earlier ones.
