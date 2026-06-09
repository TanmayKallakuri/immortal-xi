"use client";

import { Suspense, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { GameDataProvider, useGameData, ArchiveLoading } from "@/components/GameDataProvider";
import { Pitch } from "@/components/Pitch";
import { RatingBar } from "@/components/Bars";
import { decodeSeed } from "@/lib/draft/seed";
import { formationById } from "@/lib/draft/formations";
import { SIM_VERSION } from "@/lib/simulation/version";
import { simulateCampaign, type CampaignResult, type PlayedMatch } from "@/lib/simulation/campaign";
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

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="btn-ghost"
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

function ResultInner() {
  const { index, error } = useGameData();
  const params = useSearchParams();
  const seed = params.get("seed") ?? "";

  const computed = useMemo(() => {
    if (!index || !seed) return null;
    const decoded = decodeSeed(seed, index, SIM_VERSION);
    if (!decoded.ok) return { error: decoded.error } as const;
    const campaign = simulateCampaign(decoded.payload, decoded.players, index);
    const badges = detectBadges(campaign, decoded.players, index);
    return { decoded, campaign, badges } as const;
  }, [index, seed]);

  if (error) return <ArchiveLoading label={`archive error: ${error}`} />;
  if (!index) return <ArchiveLoading />;
  if (!seed)
    return (
      <div className="card p-8">
        <p className="text-(--color-chalk-dim)">
          No seed supplied. <Link className="text-(--color-brass) underline" href="/draft">Draft an XI</Link> first, or paste a
          seed into <Link className="text-(--color-brass) underline" href="/h2h">Head-to-Head</Link>.
        </p>
      </div>
    );
  if (!computed) return <ArchiveLoading label="Replaying the campaign…" />;
  if ("error" in computed)
    return (
      <div className="card border-(--color-blood) p-8">
        <p className="kicker mb-2">invalid seed</p>
        <p className="text-(--color-chalk-dim)">{computed.error}</p>
      </div>
    );

  const { decoded, campaign, badges } = computed;
  const formation = formationById(decoded.payload.formationId)!;
  const champion = ["champion", "unbeaten-champion", "perfect-champion"].includes(campaign.outcome);
  const r = campaign.leagueRecord;
  const shareUrl = typeof window !== "undefined" ? `${window.location.origin}/result?seed=${encodeURIComponent(seed)}` : "";

  return (
    <div className="space-y-8 pt-2">
      {/* outcome hero */}
      <section className={`card card-foil rise overflow-hidden p-6 sm:p-10 ${champion ? "border-(--color-brass)" : ""}`}>
        <p className="kicker">{champion ? "glory, recorded forever" : "the campaign verdict"}</p>
        <h1
          className={`mt-2 text-4xl font-semibold tracking-tight sm:text-6xl ${
            champion ? "text-(--color-brass)" : campaign.outcome === "runner-up" ? "text-(--color-chalk)" : "text-(--color-chalk-dim)"
          }`}
        >
          {campaign.outcomeLabel}
        </h1>
        <p className="font-mono mt-4 text-sm text-(--color-chalk-dim)">
          league phase {r.w}W–{r.d}D–{r.l}L · {r.gf}:{r.ga} · {r.points} pts · finished {r.rank} of 36
          {campaign.knockout.length > 0 && ` · ${campaign.knockout.filter((t) => t.won).length} knockout ties won`}
        </p>
        {badges.length > 0 && (
          <div className="mt-5 flex flex-wrap gap-2">
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
        <div className="mt-6 flex flex-wrap gap-2">
          <CopyButton text={seed} label="Copy share seed" />
          {shareUrl && <CopyButton text={shareUrl} label="Copy result link" />}
          <Link href={`/h2h?a=${encodeURIComponent(seed)}`} className="btn-brass">
            Challenge this XI →
          </Link>
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
        {/* the XI */}
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

        {/* the story */}
        <section className="space-y-4">
          <p className="kicker">the campaign</p>

          <div className="card p-5">
            <h3 className="mb-3 font-semibold">League phase</h3>
            <ul className="space-y-1.5">
              {campaign.leagueMatches.map((m) => (
                <MatchRow key={m.label} m={m} />
              ))}
            </ul>
            <LeagueTable campaign={campaign} />
          </div>

          {campaign.knockout.map((tie) => (
            <div key={tie.round} className={`card p-5 ${tie.round === "final" ? "card-foil" : ""}`}>
              <div className="mb-3 flex items-baseline justify-between">
                <h3 className="font-semibold capitalize">
                  {tie.round === "r16" ? "Round of 16" : tie.round === "qf" ? "Quarter-final" : tie.round === "sf" ? "Semi-final" : tie.round === "playoff" ? "Knockout play-off" : "Final"}
                </h3>
                <span className={`font-mono text-xs uppercase tracking-wider ${tie.won ? "text-(--color-grass-bright)" : "text-(--color-blood)"}`}>
                  {tie.won ? "through" : "out"} {tie.legs.length === 2 ? `· agg ${tie.aggregate[0]}–${tie.aggregate[1]}` : ""}
                  {tie.pens ? ` · pens ${tie.pens[0]}–${tie.pens[1]}` : ""}
                </span>
              </div>
              <ul className="space-y-1.5">
                {tie.legs.map((m) => (
                  <MatchRow key={m.label} m={m} withEvents />
                ))}
              </ul>
            </div>
          ))}

          <div className="card p-5">
            <h3 className="mb-3 font-semibold">Key moments</h3>
            <ol className="relative space-y-3 border-l border-(--color-line) pl-4">
              {campaign.keyMoments.map((k, i) => (
                <li key={i} className="text-sm text-(--color-chalk-dim)">
                  <span className="absolute -left-[5px] mt-1.5 inline-block h-2 w-2 rounded-full bg-(--color-brass)" />
                  <span className="font-mono mr-2 text-[0.62rem] uppercase tracking-wider text-(--color-brass)">{k.stage}</span>
                  {k.text}
                </li>
              ))}
            </ol>
          </div>
        </section>
      </div>
    </div>
  );
}

function MatchRow({ m, withEvents = false }: { m: PlayedMatch; withEvents?: boolean }) {
  const [open, setOpen] = useState(false);
  const won = m.userGoals > m.oppGoals;
  const drew = m.userGoals === m.oppGoals;
  return (
    <li className="rounded border border-(--color-line) bg-(--color-ink)">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left"
        aria-expanded={open}
      >
        <span className="font-mono w-24 shrink-0 text-[0.62rem] uppercase tracking-wider text-(--color-chalk-faint)">
          {m.label}
        </span>
        <span className="flex-1 truncate text-sm text-(--color-chalk-dim)">{m.opponentName}</span>
        <span
          className={`font-mono text-sm font-semibold ${won ? "text-(--color-grass-bright)" : drew ? "text-(--color-chalk-dim)" : "text-(--color-blood)"}`}
        >
          {m.userGoals}–{m.oppGoals}
        </span>
      </button>
      {open && (
        <ul className="ticket-edge space-y-1 px-3 py-2">
          <li className="font-mono text-[0.6rem] uppercase tracking-wider text-(--color-chalk-faint)">
            xG {m.home ? m.result.xg[0] : m.result.xg[1]} – {m.home ? m.result.xg[1] : m.result.xg[0]}
          </li>
          {m.result.events.length === 0 && (
            <li className="text-xs text-(--color-chalk-faint)">A quiet, tactical affair.</li>
          )}
          {m.result.events.map((e, i) => (
            <li key={i} className="text-xs text-(--color-chalk-dim)">
              <span className="font-mono mr-2 text-(--color-brass)">{e.minute}&apos;</span>
              {e.text}
            </li>
          ))}
        </ul>
      )}
      {withEvents && !open && m.result.events.length > 0 && (
        <div className="ticket-edge font-mono px-3 py-1.5 text-[0.6rem] text-(--color-chalk-faint)">
          {m.result.events.filter((e) => e.type.includes("goal")).length} goals · tap for the timeline
        </div>
      )}
    </li>
  );
}

function LeagueTable({ campaign }: { campaign: CampaignResult }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-3">
      <button type="button" className="btn-ghost w-full" onClick={() => setOpen(!open)} aria-expanded={open}>
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
