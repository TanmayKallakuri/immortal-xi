"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { GameDataProvider, useGameData, ArchiveLoading } from "@/components/GameDataProvider";
import { Pitch } from "@/components/Pitch";
import { RatingBar } from "@/components/Bars";
import { decodeSeed } from "@/lib/draft/seed";
import { saveSeed, localStorageRegistry, resolveSeedInput } from "@/lib/draft/code";
import { formationById } from "@/lib/draft/formations";
import { SIM_VERSION } from "@/lib/simulation/version";
import { simulateCampaign, type CampaignResult, type PlayedMatch, type KnockoutTie } from "@/lib/simulation/campaign";
import { detectBadges } from "@/lib/simulation/badges";

export default function ResultPage() {
  return (
    <GameDataProvider>
      <Suspense fallback={<ArchiveLoading />}>
        <ResultInner />
      </Suspense>
    </GameDataProvider>
  );
}

function CopyButton({ text, label, primary = false }: { text: string; label: string; primary?: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={primary ? "btn-brass" : "btn-ghost"}
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1600);
      }}
    >
      {copied ? "Copied ✓" : label}
    </button>
  );
}

/** The campaign as an ordered list of reveal steps — suspense by default. */
interface Step {
  kind: "league" | "table" | "tie-intro" | "leg" | "verdict";
  leagueIndex?: number;
  tie?: KnockoutTie;
  legIndex?: number;
}

function buildSteps(campaign: CampaignResult): Step[] {
  const steps: Step[] = [];
  campaign.leagueMatches.forEach((_, i) => steps.push({ kind: "league", leagueIndex: i }));
  steps.push({ kind: "table" });
  for (const tie of campaign.knockout) {
    tie.legs.forEach((_, legIndex) => steps.push({ kind: "leg", tie, legIndex }));
  }
  steps.push({ kind: "verdict" });
  return steps;
}

function ResultInner() {
  const { index, error } = useGameData();
  const params = useSearchParams();

  // accept ?seed=<full> or ?c=<compact code resolved from this device>
  const rawSeed = params.get("seed") ?? "";
  const codeParam = params.get("c") ?? "";
  const [resolved, setResolved] = useState<{ seed: string | null; error?: string } | null>(null);
  useEffect(() => {
    if (rawSeed) {
      setResolved({ seed: rawSeed });
    } else if (codeParam) {
      const r = resolveSeedInput(codeParam, localStorageRegistry());
      setResolved({ seed: r.seed, error: r.error });
    } else {
      setResolved({ seed: null });
    }
  }, [rawSeed, codeParam]);
  const seed = resolved?.seed ?? "";

  const computed = useMemo(() => {
    if (!index || !seed) return null;
    const decoded = decodeSeed(seed, index, SIM_VERSION);
    if (!decoded.ok) return { error: decoded.error } as const;
    const campaign = simulateCampaign(decoded.payload, decoded.players, index);
    const badges = detectBadges(campaign, decoded.players, index);
    return { decoded, campaign, badges, steps: buildSteps(campaign) } as const;
  }, [index, seed]);

  // compact code for sharing (saved locally; deterministic per seed)
  const [code, setCode] = useState<string | null>(null);
  useEffect(() => {
    if (seed && computed && !("error" in computed)) {
      try {
        setCode(saveSeed(seed, localStorageRegistry()));
      } catch {
        setCode(null);
      }
    }
  }, [seed, computed]);

  // progressive reveal — starts sealed; the user kicks the campaign off
  const [revealedCount, setRevealedCount] = useState(0);
  const [autoplay, setAutoplay] = useState(false);
  const autoplayRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const total = computed && !("error" in computed) ? computed.steps.length : 0;
  useEffect(() => {
    if (autoplay && revealedCount < total) {
      autoplayRef.current = setInterval(() => setRevealedCount((n) => Math.min(total, n + 1)), 1700);
      return () => {
        if (autoplayRef.current) clearInterval(autoplayRef.current);
      };
    }
  }, [autoplay, revealedCount, total]);

  if (error) return <ArchiveLoading label={`archive error: ${error}`} />;
  if (!index || resolved === null) return <ArchiveLoading />;
  if (!seed)
    return (
      <div className="card p-8">
        <p className="kicker mb-2">{resolved.error ? "code not found" : "no seed"}</p>
        <p className="text-(--color-chalk-dim)">
          {resolved.error ?? (
            <>
              No seed supplied. <Link className="text-(--color-brass) underline" href="/draft">Draft an XI</Link> first, or paste a
              seed into <Link className="text-(--color-brass) underline" href="/h2h">Head-to-Head</Link>.
            </>
          )}
        </p>
      </div>
    );
  if (!computed) return <ArchiveLoading label="Preparing the campaign…" />;
  if ("error" in computed)
    return (
      <div className="card border-(--color-blood) p-8">
        <p className="kicker mb-2">invalid seed</p>
        <p className="text-(--color-chalk-dim)">{computed.error}</p>
      </div>
    );

  const { decoded, campaign, badges, steps } = computed;
  const formation = formationById(decoded.payload.formationId)!;
  const finished = revealedCount >= steps.length;
  const visibleSteps = steps.slice(0, revealedCount);
  const r = campaign.leagueRecord;
  const champion = ["champion", "unbeaten-champion", "perfect-champion"].includes(campaign.outcome);
  // Share LINKS always embed the portable full seed so they work on any
  // device; the bare 6-char code is the quick same-device / H2H handle.
  const shareUrl =
    typeof window !== "undefined" ? `${window.location.origin}/result?seed=${encodeURIComponent(seed)}` : "";

  return (
    <div className="space-y-6 pt-2">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="kicker">
            the campaign · {decoded.payload.mode === "hard" ? "hard mode" : "classic"} · sim v{SIM_VERSION}
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">
            {finished ? campaign.outcomeLabel : "One match at a time."}
          </h1>
        </div>
        {!finished && (
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-brass" onClick={() => setRevealedCount((n) => Math.min(steps.length, n + 1))}>
              {revealedCount === 0 ? "Kick off →" : "Next →"}
            </button>
            <button type="button" className="btn-ghost" onClick={() => setAutoplay(!autoplay)} aria-pressed={autoplay}>
              {autoplay ? "Pause" : "Autoplay"}
            </button>
            <button type="button" className="btn-ghost" onClick={() => setRevealedCount(steps.length)}>
              Skip to verdict
            </button>
          </div>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_1.4fr]">
        {/* the XI (sticky context) */}
        <section className="space-y-3">
          <p className="kicker">the eleven</p>
          <Pitch
            formation={formation}
            slots={formation.slots.map((slot, i) => {
              const player = decoded.players[i];
              const cs = index.clubSeasonById.get(player.clubSeasonId);
              return { slot, player, clubLabel: cs ? `${cs.clubName} ${cs.season.slice(0, 4)}` : undefined };
            })}
          />
          <div className="card space-y-2 p-5">
            <p className="kicker mb-1">team profile</p>
            <RatingBar label="attack" value={campaign.profile.attack} />
            <RatingBar label="control" value={campaign.profile.control} />
            <RatingBar label="defense" value={campaign.profile.defense} />
            <RatingBar label="keeper" value={campaign.profile.goalkeeping} />
            <RatingBar label="aura" value={campaign.profile.aura} />
          </div>
        </section>

        {/* the story, one step at a time */}
        <section className="space-y-3">
          <p className="kicker">
            the campaign · step {Math.min(revealedCount, steps.length)} of {steps.length}
          </p>

          {visibleSteps.map((step, i) => {
            const latest = i === visibleSteps.length - 1;
            if (step.kind === "league") {
              const m = campaign.leagueMatches[step.leagueIndex!];
              return <MatchCard key={`L${step.leagueIndex}`} m={m} highlight={latest} defaultOpen={latest} />;
            }
            if (step.kind === "table") {
              return <TableCard key="table" campaign={campaign} highlight={latest} />;
            }
            if (step.kind === "leg") {
              const tie = step.tie!;
              const m = tie.legs[step.legIndex!];
              const isLastLeg = step.legIndex === tie.legs.length - 1;
              return (
                <div key={`${tie.round}-${step.legIndex}`}>
                  {step.legIndex === 0 && (
                    <p className="kicker mt-2 mb-2">
                      {tie.round === "r16" ? "round of 16" : tie.round === "qf" ? "quarter-final" : tie.round === "sf" ? "semi-final" : tie.round === "playoff" ? "knockout play-off" : "the final"}{" "}
                      · vs {tie.opponentName}
                    </p>
                  )}
                  <MatchCard m={m} highlight={latest} defaultOpen={latest} />
                  {isLastLeg && tie.legs.length === 2 && (
                    <p className="font-mono mt-1 text-right text-[0.68rem] uppercase tracking-wider text-(--color-chalk-dim)">
                      aggregate {tie.aggregate[0]}–{tie.aggregate[1]}
                      {tie.pens ? ` · pens ${tie.pens[0]}–${tie.pens[1]}` : ""} ·{" "}
                      <span className={tie.won ? "text-(--color-grass-bright)" : "text-(--color-blood)"}>
                        {tie.won ? "through" : "out"}
                      </span>
                    </p>
                  )}
                  {isLastLeg && tie.round === "final" && tie.pens && (
                    <p className="font-mono mt-1 text-right text-[0.68rem] uppercase tracking-wider text-(--color-chalk-dim)">
                      penalties {tie.pens[0]}–{tie.pens[1]}
                    </p>
                  )}
                </div>
              );
            }
            // verdict
            return (
              <VerdictCard
                key="verdict"
                campaign={campaign}
                badges={badges}
                champion={champion}
                code={code}
                seed={seed}
                shareUrl={shareUrl}
                mode={decoded.payload.mode}
              />
            );
          })}

          {!finished && revealedCount > 0 && (
            <button
              type="button"
              onClick={() => setRevealedCount((n) => Math.min(steps.length, n + 1))}
              className="card w-full p-4 text-center font-mono text-[0.7rem] uppercase tracking-[0.2em] text-(--color-brass) transition hover:border-(--color-brass)"
            >
              {steps[revealedCount].kind === "verdict"
                ? "Hear the final whistle →"
                : steps[revealedCount].kind === "table"
                  ? "See the league table →"
                  : "Next match →"}
            </button>
          )}
          {!finished && (
            <p className="font-mono text-center text-[0.6rem] uppercase tracking-[0.2em] text-(--color-chalk-faint)">
              record so far stays sealed — that&apos;s the point
            </p>
          )}
        </section>
      </div>
    </div>
  );
}

/* ---------------- cards ---------------- */

function MatchCard({ m, highlight, defaultOpen }: { m: PlayedMatch; highlight?: boolean; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(!!defaultOpen);
  const won = m.userGoals > m.oppGoals;
  const drew = m.userGoals === m.oppGoals;
  const venue = m.label.includes("(H)") ? "home" : m.label.includes("(A)") ? "away" : "neutral venue";
  const goals = m.result.events.filter((e) => e.type === "goal" || e.type === "penalty-goal");
  return (
    <div className={`card overflow-hidden ${highlight ? "spin-reel border-(--color-brass-soft)" : ""}`}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
        aria-expanded={open}
      >
        <span className="font-mono w-28 shrink-0 text-[0.62rem] uppercase tracking-wider text-(--color-chalk-faint)">
          {m.label}
        </span>
        <span className="flex-1 truncate text-sm text-(--color-chalk-dim)">
          {m.opponentName} <span className="text-(--color-chalk-faint)">· {venue}</span>
        </span>
        <span
          className={`font-mono score-tick text-base font-semibold ${won ? "text-(--color-grass-bright)" : drew ? "text-(--color-chalk-dim)" : "text-(--color-blood)"}`}
        >
          {m.userGoals}–{m.oppGoals}
          {m.result.pens ? " (p)" : m.result.etGoals ? " (aet)" : ""}
        </span>
      </button>
      {open && (
        <ul className="ticket-edge space-y-1 px-4 py-2.5">
          <li className="font-mono text-[0.6rem] uppercase tracking-wider text-(--color-chalk-faint)">
            xG {m.home ? m.result.xg[0] : m.result.xg[1]} – {m.home ? m.result.xg[1] : m.result.xg[0]} · {goals.length} goals
          </li>
          {timelineWithMarkers(m).map((e, i) =>
            e === "HT" || e === "FT" || e === "ET" ? (
              <li key={`m${i}`} className="font-mono text-[0.58rem] uppercase tracking-[0.25em] text-(--color-chalk-faint)">
                — {e === "HT" ? "half-time" : e === "FT" ? "full-time" : "extra time"} —
              </li>
            ) : (
              <li key={i} className="text-xs text-(--color-chalk-dim)">
                <span className="font-mono mr-2 text-(--color-brass)">{e.minute}&apos;</span>
                {e.text}
              </li>
            ),
          )}
          {m.result.events.length === 0 && <li className="text-xs text-(--color-chalk-faint)">A quiet, tactical affair.</li>}
        </ul>
      )}
    </div>
  );
}

type TimelineItem = PlayedMatch["result"]["events"][number] | "HT" | "FT" | "ET";
function timelineWithMarkers(m: PlayedMatch): TimelineItem[] {
  const out: TimelineItem[] = [];
  let htDone = false;
  let ftDone = false;
  for (const e of m.result.events) {
    if (!htDone && e.minute > 45) {
      out.push("HT");
      htDone = true;
    }
    if (!ftDone && e.minute > 90) {
      if (!htDone) {
        out.push("HT");
        htDone = true;
      }
      out.push("FT", "ET");
      ftDone = true;
    }
    out.push(e);
  }
  return out;
}

function TableCard({ campaign, highlight }: { campaign: CampaignResult; highlight?: boolean }) {
  const [open, setOpen] = useState(false);
  const r = campaign.leagueRecord;
  const verdictText =
    r.rank <= 8 ? "straight into the round of 16" : r.rank <= 24 ? "into the knockout play-off" : "eliminated — 25th or below";
  return (
    <div className={`card p-5 ${highlight ? "spin-reel border-(--color-brass-soft)" : ""}`}>
      <p className="kicker mb-2">league phase complete</p>
      <p className="text-lg font-semibold">
        {r.w}W–{r.d}D–{r.l}L · {r.gf}:{r.ga} · {r.points} pts —{" "}
        <span className={r.rank <= 24 ? "text-(--color-grass-bright)" : "text-(--color-blood)"}>
          finished {r.rank} of 36, {verdictText}
        </span>
      </p>
      <button type="button" className="btn-ghost mt-3 w-full" onClick={() => setOpen(!open)} aria-expanded={open}>
        {open ? "Hide" : "Show"} full 36-team table
      </button>
      {open && (
        <div className="archive-scroll mt-3 max-h-80 overflow-y-auto">
          <table className="font-mono w-full text-[0.7rem]">
            <thead className="text-left uppercase tracking-wider text-(--color-chalk-faint)">
              <tr>
                <th className="py-1 pr-2">#</th>
                <th className="py-1 pr-2">team</th>
                <th className="py-1 pr-2 text-right">w-d-l</th>
                <th className="py-1 pr-2 text-right">gd</th>
                <th className="py-1 text-right">pts</th>
              </tr>
            </thead>
            <tbody>
              {campaign.table.map((row, i) => (
                <tr
                  key={row.name}
                  className={`${row.isUser ? "bg-(--color-ink-3) text-(--color-brass)" : "text-(--color-chalk-dim)"} ${
                    i === 7 || i === 23 ? "border-b border-dashed border-(--color-line)" : ""
                  }`}
                >
                  <td className="py-1 pr-2">{i + 1}</td>
                  <td className="max-w-40 truncate py-1 pr-2">{row.name}</td>
                  <td className="py-1 pr-2 text-right">
                    {row.won}-{row.drawn}-{row.lost}
                  </td>
                  <td className="py-1 pr-2 text-right">{row.gf - row.ga}</td>
                  <td className="py-1 text-right">{row.points}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="font-mono mt-2 text-[0.6rem] uppercase tracking-wider text-(--color-chalk-faint)">
            top 8 straight to the round of 16 · 9–24 to the play-off · 25–36 eliminated
          </p>
        </div>
      )}
    </div>
  );
}

function VerdictCard({
  campaign,
  badges,
  champion,
  code,
  seed,
  shareUrl,
  mode,
}: {
  campaign: CampaignResult;
  badges: ReturnType<typeof detectBadges>;
  champion: boolean;
  code: string | null;
  seed: string;
  shareUrl: string;
  mode: string;
}) {
  const r = campaign.leagueRecord;
  return (
    <section className={`card card-foil spin-reel overflow-hidden p-6 sm:p-8 ${champion ? "border-(--color-brass)" : ""}`}>
      <p className="kicker">{champion ? "glory, recorded forever" : "the final verdict"}</p>
      <h2
        className={`mt-2 text-3xl font-semibold tracking-tight sm:text-5xl ${
          champion ? "text-(--color-brass)" : campaign.outcome === "runner-up" ? "text-(--color-chalk)" : "text-(--color-chalk-dim)"
        }`}
      >
        {campaign.outcomeLabel}
      </h2>
      <p className="font-mono mt-3 text-sm text-(--color-chalk-dim)">
        league phase {r.w}W–{r.d}D–{r.l}L · {r.gf}:{r.ga} · rank {r.rank} of 36
        {campaign.knockout.length > 0 && ` · ${campaign.knockout.filter((t) => t.won).length} knockout ties won`}
        {mode === "hard" && " · drafted blind in hard mode"}
      </p>
      {badges.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {badges.map((b) => (
            <span
              key={b.id}
              title={b.description}
              className={`font-mono rounded-full border px-3 py-1 text-[0.65rem] uppercase tracking-wider ${
                b.tier === "gold"
                  ? "border-(--color-brass) text-(--color-brass)"
                  : b.tier === "silver"
                    ? "border-(--color-chalk-dim) text-(--color-chalk)"
                    : "border-(--color-line) text-(--color-chalk-dim)"
              }`}
            >
              {b.name}
            </span>
          ))}
        </div>
      )}
      <div className="mt-5 space-y-3">
        {code && (
          <div className="flex flex-wrap items-center gap-3">
            <span className="font-mono rounded border border-(--color-brass) bg-(--color-ink) px-4 py-2 text-xl tracking-[0.25em] text-(--color-brass)">
              {code}
            </span>
            <CopyButton text={code} label="Copy code" primary />
            {shareUrl && <CopyButton text={shareUrl} label="Copy link" />}
            <Link href={`/h2h?a=${encodeURIComponent(code)}`} className="btn-ghost">
              Challenge this XI →
            </Link>
          </div>
        )}
        <details className="font-mono text-[0.6rem] leading-relaxed text-(--color-chalk-faint)">
          <summary className="cursor-pointer uppercase tracking-[0.2em]">
            portable seed (works on any device)
          </summary>
          <p className="mt-1 break-all">{seed}</p>
          <CopyButton text={seed} label="Copy full seed" />
        </details>
      </div>
    </section>
  );
}
