"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { GameDataProvider, useGameData, ArchiveLoading } from "@/components/GameDataProvider";
import { Pitch } from "@/components/Pitch";
import { RatingBar, ConfidenceDot } from "@/components/Bars";
import { FORMATIONS, formationById, type FormationSlot } from "@/lib/draft/formations";
import {
  newDraft,
  spin,
  applyPick,
  openSlots,
  type DraftState,
  type SelectablePlayer,
} from "@/lib/draft/engine";
import { encodeSeed } from "@/lib/draft/seed";
import { SIM_VERSION } from "@/lib/simulation/version";
import { profileFromSeedPlayers } from "@/lib/simulation/strength";
import type { GameDataIndex } from "@/lib/data/game-data";

function randomToken(): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  let out = "";
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return out;
}

export default function DraftPage() {
  return (
    <GameDataProvider>
      <DraftFlow />
    </GameDataProvider>
  );
}

function DraftFlow() {
  const { index, error } = useGameData();
  const [draftState, setDraftState] = useState<DraftState | null>(null);

  if (error) {
    return (
      <div className="card border-(--color-blood) p-8">
        <p className="kicker mb-2">archive unavailable</p>
        <p className="text-(--color-chalk-dim)">
          The game data could not be loaded ({error}). Run <code className="font-mono">npm run pipeline</code> and refresh.
        </p>
      </div>
    );
  }
  if (!index) return <ArchiveLoading />;
  if (!draftState) return <FormationSelect onStart={(seed, formationId) => setDraftState(newDraft(seed, formationId))} />;
  if (draftState.round >= 11) return <Review state={draftState} index={index} />;
  return <DraftRound state={draftState} index={index} onPick={setDraftState} />;
}

/* ---------------- formation selection ---------------- */

function FormationSelect({ onStart }: { onStart: (seed: string, formationId: string) => void }) {
  const [formationId, setFormationId] = useState("433");
  const [seed, setSeed] = useState("");
  const formation = formationById(formationId)!;

  return (
    <div className="space-y-8 pt-4">
      <div className="rise">
        <p className="kicker mb-2">step 1 of 13</p>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Choose your shape</h1>
        <p className="mt-2 max-w-xl text-(--color-chalk-dim)">
          Eleven rounds follow — one real club-season per spin, one player per round. The shape decides which positions
          you must fill.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {FORMATIONS.map((f, i) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFormationId(f.id)}
              className={`card rise rise-${(i % 4) + 1} p-4 text-left transition hover:border-(--color-brass-soft) ${
                f.id === formationId ? "border-(--color-brass) shadow-[0_0_24px_-8px_rgba(201,162,39,0.5)]" : ""
              }`}
              aria-pressed={f.id === formationId}
            >
              <div className={`text-xl font-semibold ${f.id === formationId ? "text-(--color-brass)" : ""}`}>{f.name}</div>
              <div className="font-mono mt-1 text-[0.6rem] uppercase tracking-wider text-(--color-chalk-faint)">
                {f.tactic}
              </div>
            </button>
          ))}
        </div>

        <div className="space-y-4">
          <Pitch formation={formation} compact slots={formation.slots.map((slot) => ({ slot, player: null }))} />
          <label className="block">
            <span className="font-mono text-[0.65rem] uppercase tracking-[0.2em] text-(--color-chalk-faint)">
              archive key (optional — same key, same spins)
            </span>
            <input
              value={seed}
              onChange={(e) => setSeed(e.target.value)}
              placeholder="leave blank for a fresh key"
              className="font-mono mt-1.5 w-full rounded-md border border-(--color-line) bg-(--color-ink) px-3 py-2.5 text-sm text-(--color-chalk) placeholder:text-(--color-chalk-faint)"
              maxLength={32}
            />
          </label>
          <button type="button" className="btn-brass w-full" onClick={() => onStart(seed.trim() || randomToken(), formationId)}>
            Open the archive →
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------------- one draft round ---------------- */

function DraftRound({
  state,
  index,
  onPick,
}: {
  state: DraftState;
  index: GameDataIndex;
  onPick: (next: DraftState) => void;
}) {
  const spun = useMemo(() => spin(state, index), [state, index]);
  const formation = formationById(state.formationId)!;
  const [selected, setSelected] = useState<SelectablePlayer | null>(null);
  const [query, setQuery] = useState("");
  const [groupFilter, setGroupFilter] = useState<string | null>(null);

  const cs = spun.clubSeason;
  const open = openSlots(state, formation);
  const filledBySlot = new Map(
    state.picks.map((p) => [p.slotId, index.playerSeasonById.get(p.playerSeasonId) ?? null]),
  );

  const list = spun.selectable
    .filter((p) => (groupFilter ? p.player.posGroup === groupFilter : true))
    .filter((p) => (query ? p.player.name.toLowerCase().includes(query.toLowerCase()) : true))
    .sort((a, b) => Number(!!a.blockedReason) - Number(!!b.blockedReason) || b.player.ratings.overall - a.player.ratings.overall);

  const place = (slot: FormationSlot) => {
    if (!selected || selected.blockedReason) return;
    if (!selected.eligibleSlots.some((e) => e.slot.id === slot.id)) return;
    onPick(applyPick(state, cs, selected.player.id, slot.id, index));
    setSelected(null);
    setQuery("");
    setGroupFilter(null);
  };

  return (
    <div className="space-y-5 pt-2">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="kicker">round {state.round + 1} of 11 · archive key {state.draftSeed}</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">The reel lands on…</h1>
        </div>
        <div className="font-mono flex gap-1" aria-label={`Round ${state.round + 1} of 11`}>
          {Array.from({ length: 11 }, (_, i) => (
            <span
              key={i}
              className={`h-1.5 w-5 rounded-full ${i < state.round ? "bg-(--color-brass)" : i === state.round ? "bg-(--color-grass-bright)" : "bg-(--color-line)"}`}
            />
          ))}
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.35fr_1fr]">
        <div className="space-y-4">
          {/* spun club-season card */}
          <div key={cs.id} className="card card-foil spin-reel overflow-hidden">
            <div className="flex flex-wrap items-baseline justify-between gap-2 px-5 pt-5 sm:px-6">
              <div>
                <div className="font-mono text-[0.65rem] uppercase tracking-[0.25em] text-(--color-brass)">
                  {cs.competition === "EC" ? "European Cup" : "Champions League"} · {cs.season} ·{" "}
                  {cs.progression === "W" ? "champions" : "finalists"}
                </div>
                <h2 className="mt-1 text-3xl font-semibold tracking-tight sm:text-4xl">{cs.clubName}</h2>
                <p className="font-mono mt-1 text-[0.7rem] text-(--color-chalk-dim)">
                  {cs.progression === "W" ? "beat" : "lost to"} {cs.opponentClubName} {cs.finalScore} in the final ·{" "}
                  {cs.eraLabel}
                </p>
              </div>
              <ConfidenceDot label={cs.confidence.label} />
            </div>

            {/* squad list */}
            <div className="mt-4 px-5 pb-5 sm:px-6">
              {spun.selectable.length > 12 && (
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="search squad…"
                    className="font-mono w-40 rounded border border-(--color-line) bg-(--color-ink) px-2.5 py-1.5 text-xs text-(--color-chalk)"
                    aria-label="Search squad"
                  />
                  {["GK", "DF", "MF", "FW"].map((g) => (
                    <button
                      key={g}
                      type="button"
                      onClick={() => setGroupFilter(groupFilter === g ? null : g)}
                      className={`font-mono rounded border px-2 py-1 text-[0.62rem] uppercase tracking-wider ${
                        groupFilter === g
                          ? "border-(--color-brass) text-(--color-brass)"
                          : "border-(--color-line) text-(--color-chalk-faint) hover:text-(--color-chalk)"
                      }`}
                      aria-pressed={groupFilter === g}
                    >
                      {g}
                    </button>
                  ))}
                </div>
              )}
              <ul className="archive-scroll grid max-h-[26rem] gap-1.5 overflow-y-auto pr-1 sm:grid-cols-2">
                {list.map((sp) => {
                  const p = sp.player;
                  const isSel = selected?.player.id === p.id;
                  return (
                    <li key={p.id}>
                      <button
                        type="button"
                        disabled={!!sp.blockedReason}
                        onClick={() => setSelected(isSel ? null : sp)}
                        className={`w-full rounded-lg border p-3 text-left transition ${
                          sp.blockedReason
                            ? "cursor-not-allowed border-(--color-line) opacity-40"
                            : isSel
                              ? "border-(--color-brass) bg-(--color-ink-3)"
                              : "border-(--color-line) bg-(--color-ink) hover:border-(--color-brass-soft)"
                        }`}
                        aria-pressed={isSel}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate font-semibold">
                            {p.name}
                            {p.captain && <span className="ml-1 text-(--color-brass)" title="captain">©</span>}
                          </span>
                          <span className="font-mono text-lg text-(--color-brass)">{Math.round(p.ratings.overall)}</span>
                        </div>
                        <div className="font-mono mt-0.5 flex flex-wrap items-center gap-x-2 text-[0.6rem] uppercase tracking-wider text-(--color-chalk-faint)">
                          <span className="text-(--color-chalk-dim)">{p.pos}</span>
                          <span>{p.role}</span>
                          {p.finalGoals > 0 && <span className="text-(--color-brass)">{p.finalGoals}g in final</span>}
                          {p.careerFinals > 1 && <span>{p.careerFinals} finals</span>}
                          {p.nationality && <span>{p.nationality}</span>}
                          {p.confidence.label !== "high" && <span className="text-(--color-blood)">{p.confidence.label} conf</span>}
                        </div>
                        {sp.blockedReason && (
                          <div className="font-mono mt-1 text-[0.6rem] uppercase tracking-wider text-(--color-blood)">
                            {sp.blockedReason}
                          </div>
                        )}
                        {isSel && (
                          <div className="mt-2 space-y-1">
                            <RatingBar label="atk" value={p.ratings.attack} />
                            <RatingBar label="ctl" value={p.ratings.control} />
                            <RatingBar label="def" value={p.ratings.defense} />
                            {p.posGroup === "GK" && <RatingBar label="gk" value={p.ratings.goalkeeping} />}
                            <RatingBar label="aura" value={p.ratings.uclAura} />
                            <div className="font-mono pt-1 text-[0.62rem] uppercase tracking-wider text-(--color-chalk-dim)">
                              place at:{" "}
                              {sp.eligibleSlots
                                .slice()
                                .sort((a, b) => b.fit - a.fit)
                                .map((e) => (
                                  <button
                                    key={e.slot.id}
                                    type="button"
                                    onClick={(ev) => {
                                      ev.stopPropagation();
                                      place(e.slot);
                                    }}
                                    className={`mr-1 mb-1 inline-block rounded border px-2 py-0.5 ${
                                      e.fit >= 1
                                        ? "border-(--color-brass) text-(--color-brass)"
                                        : e.fit >= 0.85
                                          ? "border-(--color-line) text-(--color-chalk)"
                                          : "border-(--color-blood) text-(--color-blood)"
                                    } hover:bg-(--color-ink-2)`}
                                    title={e.fit < 1 ? `position-fit penalty ×${e.fit}` : "natural position"}
                                  >
                                    {e.slot.label}
                                    {e.fit < 1 ? "*" : ""}
                                  </button>
                                ))}
                            </div>
                          </div>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
          <p className="font-mono text-[0.62rem] uppercase tracking-[0.18em] text-(--color-chalk-faint)">
            no rerolls — the archive gives what it gives. * = out-of-position penalty.
          </p>
        </div>

        {/* pitch with current XI */}
        <div className="space-y-3">
          <Pitch
            formation={formation}
            onSlotClick={selected && !selected.blockedReason ? place : undefined}
            slots={formation.slots.map((slot) => {
              const player = filledBySlot.get(slot.id) ?? null;
              const cs2 = player ? index.clubSeasonById.get(player.clubSeasonId) : null;
              return {
                slot,
                player,
                clubLabel: cs2 ? `${cs2.clubName} ${cs2.season.slice(0, 4)}` : undefined,
                highlight: !!selected && !selected.blockedReason && selected.eligibleSlots.some((e) => e.slot.id === slot.id),
              };
            })}
          />
          <p className="font-mono text-center text-[0.62rem] uppercase tracking-[0.18em] text-(--color-chalk-faint)">
            {selected ? "tap a glowing slot to place " + selected.player.name : `${open.length} positions still open`}
          </p>
        </div>
      </div>
    </div>
  );
}

/* ---------------- review + simulate ---------------- */

function Review({ state, index }: { state: DraftState; index: GameDataIndex }) {
  const router = useRouter();
  const formation = formationById(state.formationId)!;
  const bySlot = new Map(state.picks.map((p) => [p.slotId, p.playerSeasonId]));
  const players = formation.slots.map((s) => index.playerSeasonById.get(bySlot.get(s.id)!)!);
  const { profile } = useMemo(
    () => profileFromSeedPlayers(state.formationId, players, index),
    [state.formationId, players, index],
  );
  const seed = useMemo(
    () =>
      encodeSeed(
        {
          dataVersion: index.data.dataVersion,
          simVersion: SIM_VERSION,
          formationId: state.formationId,
          draftSeed: state.draftSeed,
          playerSeasonIds: formation.slots.map((s) => bySlot.get(s.id)!),
        },
        index,
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state, index],
  );
  const avgConf = profile.avgConfidence;

  return (
    <div className="space-y-6 pt-2">
      <div className="rise">
        <p className="kicker">the team sheet is signed</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight sm:text-4xl">Your Immortal XI</h1>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_1.1fr]">
        <Pitch
          formation={formation}
          slots={formation.slots.map((slot) => {
            const player = index.playerSeasonById.get(bySlot.get(slot.id)!)!;
            const cs = index.clubSeasonById.get(player.clubSeasonId);
            return { slot, player, clubLabel: cs ? `${cs.clubName} ${cs.season.slice(0, 4)}` : undefined };
          })}
        />

        <div className="space-y-4">
          <div className="card card-foil rise rise-1 space-y-2 p-5">
            <p className="kicker mb-2">team profile</p>
            <RatingBar label="attack" value={profile.attack} />
            <RatingBar label="control" value={profile.control} />
            <RatingBar label="defense" value={profile.defense} />
            <RatingBar label="keeper" value={profile.goalkeeping} />
            <RatingBar label="clutch" value={profile.clutch} />
            <RatingBar label="aura" value={profile.aura} />
            <div className="font-mono flex justify-between pt-2 text-[0.68rem] uppercase tracking-wider text-(--color-chalk-dim)">
              <span>chemistry {profile.chemistry >= 0 ? "+" : ""}{profile.chemistry.toFixed(1)}</span>
              <span>data confidence {(avgConf * 100).toFixed(0)}%</span>
            </div>
          </div>

          <div className="card rise rise-2 p-5">
            <p className="kicker mb-2">scouting notes</p>
            <ul className="space-y-1.5 text-sm text-(--color-chalk-dim)">
              {profile.notes.length ? profile.notes.map((n) => <li key={n}>— {n}</li>) : <li>— A balanced, honest team.</li>}
              {profile.links
                .filter((l) => l.kind === "same-club-season" || l.kind === "mismatch-penalty")
                .slice(0, 4)
                .map((l) => (
                  <li key={l.detail} className={l.value < 0 ? "text-(--color-blood)" : "text-(--color-grass-bright)"}>
                    — {l.detail} ({l.value > 0 ? "+" : ""}
                    {l.value})
                  </li>
                ))}
            </ul>
          </div>

          <button
            type="button"
            className="btn-brass rise rise-3 w-full text-base"
            onClick={() => router.push(`/result?seed=${encodeURIComponent(seed)}`)}
          >
            Kick off the campaign →
          </button>
          <p className="font-mono break-all text-[0.6rem] leading-relaxed text-(--color-chalk-faint)">
            share seed: {seed}
          </p>
        </div>
      </div>
    </div>
  );
}
