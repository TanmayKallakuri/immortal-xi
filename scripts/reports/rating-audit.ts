/**
 * GLOBAL RATING AUDIT:  npm run rating-audit
 *
 * Scans every exported player-season rating for structural problems — the
 * "support player outranks the decisive star" class of bug — instead of
 * patching individual examples. Writes data/reports/rating-audit.json and
 * prints a summary. Exits 1 if any HIGH-severity finding exists.
 *
 * Checks:
 *  A. weak-evidence-high:    bench/sub/squad players with very high overall
 *  B. defender-over-scorer:  a defender outrating a goal-scoring attacker of
 *                            the SAME club-season by more than the captain
 *                            margin allows
 *  C. context-overweight:    overall exceeding context base + max personal
 *                            evidence (only possible via overrides — listed)
 *  D. identical-across-seasons: same player, different seasons, different
 *                            personal evidence, identical overall
 *  E. low-confidence-extreme: overall >= 90 on records below 0.7 confidence
 *  F. era-extreme:           pre-1970 ratings >= 95 without an override
 */
import fs from "node:fs";
import path from "node:path";
import { loadGameData } from "../../lib/data/game-data";
import { contextBaseFor, type EvidenceRole, type TeamTier } from "../../lib/ratings/model";
import * as W from "../../lib/ratings/config";

interface Finding {
  check: string;
  severity: "high" | "info";
  playerSeasonId: string;
  detail: string;
}

async function main() {
  const index = await loadGameData();
  const findings: Finding[] = [];
  const ps = index.data.playerSeasons;

  // A: weak evidence, high overall
  for (const p of ps) {
    const weakRole = p.role === "bench" || p.role === "sub" || p.role === "squad";
    if (weakRole && !p.overrideApplied && p.ratings.overall >= 86) {
      findings.push({
        check: "weak-evidence-high",
        severity: "high",
        playerSeasonId: p.id,
        detail: `${p.name}: role=${p.role}, no decisive evidence, overall ${p.ratings.overall}`,
      });
    }
  }

  // B: defender outranks goal-scoring attacker of the same club-season
  // (scoring evidence = goals in the final OR European goals that season).
  // A defender with STRONGER apps evidence may legitimately outrank a fringe
  // scorer, so only same-or-weaker apps tiers count as an inversion.
  const goalsOf = (p: (typeof ps)[number]) => p.finalGoals + (p.seasonGoals ?? 0);
  const appsTier = (p: (typeof ps)[number]) =>
    p.seasonApps === null ? 0 : p.seasonApps >= 8 ? 2 : p.seasonApps >= 4 ? 1 : p.seasonApps <= 1 ? -1 : 0;
  for (const cs of index.draftable) {
    const squad = cs.playerSeasonIds.map((id) => index.playerSeasonById.get(id)!).filter(Boolean);
    const scorers = squad.filter((p) => (p.posGroup === "FW" || p.posGroup === "MF") && goalsOf(p) > 0 && !p.overrideApplied);
    const defenders = squad.filter((p) => p.posGroup === "DF" && goalsOf(p) === 0 && !p.overrideApplied);
    for (const scorer of scorers) {
      for (const df of defenders) {
        if (df.role === scorer.role && appsTier(df) <= appsTier(scorer) && df.ratings.overall > scorer.ratings.overall) {
          findings.push({
            check: "defender-over-scorer",
            severity: "high",
            playerSeasonId: df.id,
            detail: `${df.name} (${df.ratings.overall}) outranks final-scorer ${scorer.name} (${scorer.ratings.overall}) in ${cs.clubName} ${cs.season}`,
          });
        }
      }
    }
  }

  // C: overall above what context + personal evidence can produce
  const maxPersonal =
    W.FINAL_GOAL_OVERALL_CAP + W.CAPTAIN_OVERALL + W.CONTINENTAL_GOAL_OVERALL_CAP + W.CONTINENTAL_APPS_CORE_BONUS;
  for (const p of ps) {
    const base = contextBaseFor(p.role as EvidenceRole, progressionOf(p.clubSeasonId, index) as TeamTier);
    if (p.ratings.overall > base + maxPersonal + 0.01) {
      findings.push({
        check: "context-overweight",
        severity: p.overrideApplied ? "info" : "high",
        playerSeasonId: p.id,
        detail: `${p.name}: overall ${p.ratings.overall} exceeds context ${base} + personal cap ${maxPersonal}${p.overrideApplied ? " (documented override)" : ""}`,
      });
    }
  }

  // D: identical overall across seasons despite different personal evidence
  const byPlayer = new Map<string, typeof ps>();
  for (const p of ps) byPlayer.set(p.playerId, [...(byPlayer.get(p.playerId) ?? []), p]);
  for (const [, seasons] of byPlayer) {
    if (seasons.length < 2) continue;
    for (let i = 0; i < seasons.length; i++) {
      for (let j = i + 1; j < seasons.length; j++) {
        const a = seasons[i];
        const b = seasons[j];
        const evidenceDiffers = a.finalGoals !== b.finalGoals || a.role !== b.role || a.captain !== b.captain;
        if (evidenceDiffers && a.ratings.overall === b.ratings.overall && !a.overrideApplied && !b.overrideApplied) {
          const aTier = progressionOf(a.clubSeasonId, index);
          const bTier = progressionOf(b.clubSeasonId, index);
          if (aTier === bTier) {
            findings.push({
              check: "identical-across-seasons",
              severity: "info",
              playerSeasonId: a.id,
              detail: `${a.name}: ${a.id} and ${b.id} share overall ${a.ratings.overall} despite different season evidence`,
            });
          }
        }
      }
    }
  }

  // E: low-confidence extremes
  for (const p of ps) {
    if (p.confidence.score < 0.7 && p.ratings.overall >= 90) {
      findings.push({
        check: "low-confidence-extreme",
        severity: p.overrideApplied ? "info" : "high",
        playerSeasonId: p.id,
        detail: `${p.name}: overall ${p.ratings.overall} at confidence ${p.confidence.score}`,
      });
    }
  }

  // F: old-era unsupported extremes
  for (const p of ps) {
    const cs = index.clubSeasonById.get(p.clubSeasonId);
    if (cs && cs.year < 1970 && p.ratings.overall >= 95 && !p.overrideApplied) {
      findings.push({
        check: "era-extreme",
        severity: "high",
        playerSeasonId: p.id,
        detail: `${p.name}: ${p.ratings.overall} in ${cs.year} without documented override`,
      });
    }
  }

  const high = findings.filter((f) => f.severity === "high");
  const out = {
    generatedAt: new Date().toISOString(),
    formulaVersion: (await import("../../lib/ratings/model")).FORMULA_VERSION,
    totals: { findings: findings.length, high: high.length, playerSeasons: ps.length },
    findings,
  };
  const dir = path.join(process.cwd(), "data", "reports");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "rating-audit.json"), JSON.stringify(out, null, 2), "utf8");

  console.log(`RATING AUDIT (${ps.length} player-seasons)`);
  const byCheck = new Map<string, number>();
  for (const f of findings) byCheck.set(f.check, (byCheck.get(f.check) ?? 0) + 1);
  for (const [check, n] of byCheck) console.log(`  ${check}: ${n}`);
  if (findings.length === 0) console.log("  no findings — all ratings structurally sound");
  for (const f of high.slice(0, 20)) console.log(`  [HIGH] ${f.check}: ${f.detail}`);
  console.log(`  -> data/reports/rating-audit.json`);
  process.exit(high.length > 0 ? 1 : 0);
}

function progressionOf(clubSeasonId: string, index: Awaited<ReturnType<typeof loadGameData>>): string {
  return index.clubSeasonById.get(clubSeasonId)?.progression ?? "PART";
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
