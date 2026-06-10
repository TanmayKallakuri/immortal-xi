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
 *                            and no season evidence behind it
 *  B. defender-over-scorer:  a defender outrating a goal-scoring attacker of
 *                            the SAME club-season at the same evidence tier
 *  C. context-overweight:    overall exceeding context base + max personal
 *                            evidence (only possible via overrides — listed)
 *  D. identical-across-seasons: same player, different seasons, different
 *                            personal evidence, identical overall
 *  E. low-confidence-extreme: overall >= 90 on records below 0.7 confidence
 *  F. era-extreme:           pre-1970 ratings >= 95 without an override
 *  G. flat-squad:            a squad WITH per-player stats whose ratings
 *                            cluster instead of spreading (stats exist, so
 *                            sameness means the model ignored them); squads
 *                            WITHOUT stats are listed as info data gaps
 *  H. star-not-separated:    the squad's strongest-evidence player not
 *                            clearly above the squad median
 *  I. fringe-high:           fringe player (<=1 European app, 0 goals)
 *                            rated above 78 without an override
 *  J. backup-gk-near-starter: backup GK (<=2 apps) within 2 points of the
 *                            starting GK (>=8 apps) of the same squad
 *  K. breakout-stuck:        strong same-season production (5+ European
 *                            goals on 6+ apps) stuck below 80 overall
 *  R. monaco-regression:     Monaco 2016/17 calibration sentinels (the squad
 *                            that exposed the flat-rating bug class)
 */
import fs from "node:fs";
import path from "node:path";
import { loadGameData } from "../../lib/data/game-data";
import { contextBaseFor, maxPersonalEvidence, type EvidenceRole, type TeamTier } from "../../lib/ratings/model";

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

  const goalsOf = (p: (typeof ps)[number]) => p.finalGoals + (p.seasonGoals ?? 0);
  const appsOf = (p: (typeof ps)[number]) => p.seasonApps ?? 0;
  const hasStrongEvidence = (p: (typeof ps)[number]) => goalsOf(p) >= 4 || appsOf(p) >= 8;

  // A: weak evidence, high overall
  for (const p of ps) {
    const weakRole = p.role === "bench" || p.role === "sub" || p.role === "squad";
    if (weakRole && !p.overrideApplied && p.ratings.overall >= 86 && !hasStrongEvidence(p)) {
      findings.push({
        check: "weak-evidence-high",
        severity: "high",
        playerSeasonId: p.id,
        detail: `${p.name}: role=${p.role}, no decisive evidence, overall ${p.ratings.overall}`,
      });
    }
  }

  // B: defender outranks goal-scoring attacker of the same club-season.
  // A defender who PLAYED MORE may legitimately edge a low-production scorer,
  // so an inversion requires the defender's involvement to be no stronger
  // than the scorer's AND the scorer's production to be meaningful (a final
  // goal, or several European goals that season).
  const meaningfulProduction = (p: (typeof ps)[number]) => p.finalGoals >= 1 || (p.seasonGoals ?? 0) >= 3;
  for (const cs of index.draftable) {
    const squad = cs.playerSeasonIds.map((id) => index.playerSeasonById.get(id)!).filter(Boolean);
    const scorers = squad.filter(
      (p) => (p.posGroup === "FW" || p.posGroup === "MF") && goalsOf(p) > 0 && meaningfulProduction(p) && !p.overrideApplied,
    );
    const defenders = squad.filter((p) => p.posGroup === "DF" && goalsOf(p) === 0 && !p.overrideApplied);
    for (const scorer of scorers) {
      for (const df of defenders) {
        if (df.role === scorer.role && appsOf(df) <= appsOf(scorer) && df.ratings.overall > scorer.ratings.overall) {
          findings.push({
            check: "defender-over-scorer",
            severity: "high",
            playerSeasonId: df.id,
            detail: `${df.name} (${df.ratings.overall}) outranks scorer ${scorer.name} (${scorer.ratings.overall}) in ${cs.clubName} ${cs.season}`,
          });
        }
      }
    }
  }

  // C: overall above what context + personal evidence can produce
  for (const p of ps) {
    const base = contextBaseFor(p.role as EvidenceRole, progressionOf(p.clubSeasonId, index) as TeamTier);
    const maxPersonal = maxPersonalEvidence(p.role as EvidenceRole);
    // +0.05: overall rounds to one decimal, so the cap can round up half a step
    if (p.ratings.overall > base + maxPersonal + 0.05) {
      findings.push({
        check: "context-overweight",
        severity: p.overrideApplied ? "info" : "high",
        playerSeasonId: p.id,
        detail: `${p.name}: overall ${p.ratings.overall} exceeds context ${base} + personal cap ${maxPersonal.toFixed(1)}${p.overrideApplied ? " (documented override)" : ""}`,
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

  // G + H + J: per-squad structure of squad-list (role=squad) club-seasons
  for (const cs of index.draftable) {
    const squad = cs.playerSeasonIds.map((id) => index.playerSeasonById.get(id)!).filter(Boolean);
    const squadRole = squad.filter((p) => p.role === "squad");
    if (squadRole.length < 11) continue; // finalist squads carry lineup roles
    const statted = squad.filter((p) => p.seasonApps !== null);
    const overalls = squad.map((p) => p.ratings.overall);
    const spread = Math.max(...overalls) - Math.min(...overalls);
    const distinct = new Set(overalls).size;

    if (statted.length >= 8) {
      // stats exist: sameness means the model ignored the evidence
      if (distinct <= 2 || spread < 6) {
        findings.push({
          check: "flat-squad",
          severity: "high",
          playerSeasonId: cs.id,
          detail: `${cs.clubName} ${cs.season}: ${squad.length} players, stats for ${statted.length}, but spread ${spread.toFixed(1)} / ${distinct} distinct overalls`,
        });
      }
      // H: the strongest-evidence player must stand clear of the median
      const sorted = [...overalls].sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)];
      const star = [...statted].sort((a, b) => goalsOf(b) * 2 + appsOf(b) - (goalsOf(a) * 2 + appsOf(a)))[0];
      if (star && goalsOf(star) >= 4 && star.ratings.overall < median + 3 && !star.overrideApplied) {
        findings.push({
          check: "star-not-separated",
          severity: "high",
          playerSeasonId: star.id,
          detail: `${star.name} (${star.ratings.overall}) carries the strongest evidence in ${cs.clubName} ${cs.season} but sits at squad median ${median}`,
        });
      }
      // J: backup GK near starter GK
      const gks = squad.filter((p) => p.posGroup === "GK" && p.seasonApps !== null);
      const starterGk = gks.find((p) => appsOf(p) >= 8);
      for (const gk of gks) {
        if (starterGk && gk !== starterGk && appsOf(gk) <= 2 && gk.ratings.overall > starterGk.ratings.overall - 2) {
          findings.push({
            check: "backup-gk-near-starter",
            severity: "high",
            playerSeasonId: gk.id,
            detail: `${gk.name} (${gk.ratings.overall}, ${appsOf(gk)} apps) too close to starter ${starterGk.name} (${starterGk.ratings.overall}) in ${cs.clubName} ${cs.season}`,
          });
        }
      }
    } else {
      findings.push({
        check: "flat-squad",
        severity: "info",
        playerSeasonId: cs.id,
        detail: `${cs.clubName} ${cs.season}: no per-player season stats on its source page — squad rates flat by necessity (data gap, low confidence)`,
      });
    }
  }

  // I: fringe players rated above 78
  for (const p of ps) {
    if (p.role !== "squad" || p.overrideApplied) continue;
    if (p.seasonApps !== null && p.seasonApps <= 1 && goalsOf(p) === 0 && p.ratings.overall > 78) {
      findings.push({
        check: "fringe-high",
        severity: "high",
        playerSeasonId: p.id,
        detail: `${p.name}: ${p.seasonApps} European apps, 0 goals, overall ${p.ratings.overall}`,
      });
    }
  }

  // K: breakout production stuck in the low/mid 70s
  for (const p of ps) {
    if (p.overrideApplied) continue;
    if (
      (p.posGroup === "FW" || p.posGroup === "MF") &&
      (p.seasonGoals ?? 0) >= 5 &&
      (p.seasonApps ?? 0) >= 6 &&
      p.ratings.overall < 80
    ) {
      findings.push({
        check: "breakout-stuck",
        severity: "high",
        playerSeasonId: p.id,
        detail: `${p.name}: ${p.seasonGoals} European goals in ${p.seasonApps} apps but overall ${p.ratings.overall}`,
      });
    }
  }

  // R: Monaco 2016/17 regression sentinels — the club-season that exposed the
  // flat-rating bug class. These assert the GLOBAL model's output on real
  // data; nothing here writes a rating.
  const monaco = index.clubSeasonById.get("cs-monaco-2016-17");
  if (monaco) {
    const squad = monaco.playerSeasonIds.map((id) => index.playerSeasonById.get(id)!).filter(Boolean);
    const overalls = squad.map((p) => p.ratings.overall);
    const spread = Math.max(...overalls) - Math.min(...overalls);
    const distinct = new Set(overalls).size;
    const sorted = [...overalls].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    const fail = (id: string, detail: string) =>
      findings.push({ check: "monaco-regression", severity: "high", playerSeasonId: id, detail });

    const mbappe = squad.find((p) => p.id === "ps-kylian-mbappe-2017");
    if (mbappe) {
      if (mbappe.ratings.overall < 82 || mbappe.ratings.overall > 88) {
        fail(mbappe.id, `Mbappé 2016/17 overall ${mbappe.ratings.overall} outside the evidence-supported 82-88 band`);
      }
      if (mbappe.ratings.overall < median + 5) {
        fail(mbappe.id, `Mbappé 2016/17 (${mbappe.ratings.overall}) not separated from squad median (${median})`);
      }
    }
    const falcao = squad.find((p) => p.id === "ps-radamel-falcao-2017");
    if (falcao && falcao.ratings.overall < 84) {
      fail(falcao.id, `Falcao 2016/17 overall ${falcao.ratings.overall} below the star band despite top evidence`);
    }
    if (spread < 12 || distinct < 10) {
      fail(monaco.id, `Monaco 2016/17 squad spread ${spread.toFixed(1)} / ${distinct} distinct — still clustered`);
    }
    for (const p of squad) {
      if (p.seasonApps !== null && p.seasonApps <= 1 && goalsOf(p) === 0 && p.ratings.overall > 74) {
        fail(p.id, `Monaco 2016/17 reserve ${p.name} rated ${p.ratings.overall} despite no involvement`);
      }
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
  for (const f of high.slice(0, 25)) console.log(`  [HIGH] ${f.check}: ${f.detail}`);
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
