"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
  type DraftMode,
  type DraftState,
  type SelectablePlayer,
} from "@/lib/draft/engine";
import { buildRevealPlan, canSelectDuringReveal, type RevealPhase } from "@/lib/draft/reveal";
import { visibilityFor } from "@/lib/draft/visibility";
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
  if (!draftState)
    return <SetupScreen onStart={(seed, formationId, mode) => setDraftState(newDraft(seed, formationId, mode))} />;
  if (draftState.round >= 11) return <Review state={draftState} index={index} />;
  return <DraftRound state={draftState} index={index} onPick={setDraftState} />;
}

/* ---------------- mode + formation selection ---------------- */

function SetupScreen({ onStart }: { onStart: (seed: string, formationId: string, mode: DraftMode) => void }) {
  const [mode, setMode] = useState<DraftMode>("classic");
  const [formationId, setFormationId] = useState("433");
  const [seed, setSeed] = useState("");
  const formation = formationById(formationId)!;

  return (
    <div className="space-y-8 pt-4">
      <div className="rise">
        <p className="kicker mb-2">set up your run</p>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Choose your rules, then your shape</h1>
        <p className="mt-2 max-w-xl text-(--color-chalk-dim)">
          Eleven spins of the archive follow — one real club-season per spin, one player per round. In every mode, how
          a team finished that season stays hidden until your XI is signed.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="Game mode">
        {(
          [
            {
              id: "classic" as const,
              name: "Classic Mode",
              desc: "Full player cards: positions, ratings, season stats, data confidence. Team finishes stay hidden until the draft ends.",
            },
            {
              id: "hard" as const,
              name: "Hard Mode",
              desc: "Football knowledge only: name, position, club, season, nationality. No ratings, no stats, no hints — they reveal after your XI is complete.",
            },
          ]
        ).map((m) => (
          <button
            key={m.id}
            type="button"
            role="radio"
            aria-checked={mode === m.id}
            onClick={() => setMode(m.id)}
            className={`card card-foil p-5 text-left transition hover:border-(--color-brass-soft) ${
              mode === m.id ? "border-(--color-brass) shadow-[0_0_24px_-8px_rgba(201,162,39,0.5)]" : ""
            }`}
          >
            <div className={`text-xl font-semibold ${mode === m.id ? "text-(--color-brass)" : ""}`}>{m.name}</div>
            <p className="mt-1.5 text-sm leading-relaxed text-(--color-chalk-dim)">{m.desc}</p>
          </button>
        ))}
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
          <button
            type="button"
            className="btn-brass w-full"
            onClick={() => onStart(seed.trim() || randomToken(), formationId, mode)}
          >
            Open the archive →
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------------- one draft round ---------------- */

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

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
  const vis = visibilityFor(state.mode, "draft");
  const [selected, setSelected] = useState<SelectablePlayer | null>(null);
  const [query, setQuery] = useState("");
  const [groupFilter, setGroupFilter] = useState<string | null>(null);

  // ---- archive-flip reveal (deterministic; cosmetic decoys only) ----
  const reducedMotion = useReducedMotion();
  const cs = spun.clubSeason;
  const csLabel = `${cs.clubName} · ${cs.season}`;
  const decoyPool = useMemo(
    () => index.draftable.map((d) => `${d.clubName} · ${d.season}`),
    [index],
  );
  const plan = useMemo(
    () => buildRevealPlan(`${state.draftSeed}|${state.formationId}|r${state.round}`, decoyPool, csLabel, reducedMotion),
    [state.draftSeed, state.formationId, state.round, decoyPool, csLabel, reducedMotion],
  );
  const [phase, setPhase] = useState<RevealPhase>(plan.durationMs === 0 ? "revealed" : "revealing");
  const [frame, setFrame] = useState(0);
  const timers = useRef<{ iv?: ReturnType<typeof setInterval>; to?: ReturnType<typeof setTimeout> }>({});

  useEffect(() => {
    setSelected(null);
    setQuery("");
    setGroupFilter(null);
    if (plan.durationMs === 0) {
      setPhase("revealed");
      return;
    }
    setPhase("revealing");
    setFrame(0);
    timers.current.iv = setInterval(() => setFrame((f) => f + 1), plan.frameMs);
    timers.current.to = setTimeout(() => {
      clearInterval(timers.current.iv);
      setPhase("revealed");
    }, plan.durationMs);
    return () => {
      clearInterval(timers.current.iv);
      clearTimeout(timers.current.to);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.round, plan.durationMs]);

  const skip = () => {
    clearInterval(timers.current.iv);
    clearTimeout(timers.current.to);
    setPhase("revealed");
  };
  const revealed = canSelectDuringReveal(phase);

  const open = openSlots(state, formation);
  const filledBySlot = new Map(
    state.picks.map((p) => [p.slotId, index.playerSeasonById.get(p.playerSeasonId) ?? null]),
  );

  const list = spun.selectable
    .filter((p) => (groupFilter ? p.player.posGroup === groupFilter : true))
    .filter((p) => (query ? p.player.name.toLowerCase().includes(query.toLowerCase()) : true))
    .sort((a, b) => {
      const blocked = Number(!!a.blockedReason) - Number(!!b.blockedReason);
      if (blocked !== 0) return blocked;
      if (vis.ratings) return b.player.ratings.overall - a.player.ratings.overall || a.player.id.localeCompare(b.player.id);
      // hard mode: stable position-then-name order, no rating hints
      const groupOrder = { GK: 0, DF: 1, MF: 2, FW: 3 } as const;
      return groupOrder[a.player.posGroup] - groupOrder[b.player.posGroup] || a.player.name.localeCompare(b.player.name);
    });

  const place = (slot: FormationSlot) => {
    if (!revealed || !selected || selected.blockedReason) return;
    if (!selected.eligibleSlots.some((e) => e.slot.id === slot.id)) return;
    onPick(applyPick(state, cs, selected.player.id, slot.id, index));
  };

  return (
    <div className="space-y-5 pt-2">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="kicker">
            round {state.round + 1} of 11 · {state.mode === "hard" ? "hard mode" : "classic"} · key {state.draftSeed}
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">
            {revealed ? "The archive opens on…" : "Flipping through the archive…"}
          </h1>
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
          {!revealed ? (
            /* ---- reveal animation: programme pages flipping past ---- */
            <button
              type="button"
              onClick={skip}
              className="card card-foil block w-full cursor-pointer overflow-hidden px-5 py-14 text-center sm:px-6"
              aria-label="Skip reveal animation"
            >
              <div className="font-mono text-[0.65rem] uppercase tracking-[0.3em] text-(--color-chalk-faint)">
                european archive · 1955 — today
              </div>
              <div
                key={frame}
                className="mt-4 text-2xl font-semibold tracking-tight text-(--color-chalk-dim) sm:text-3xl"
                style={{ opacity: 0.55 + 0.45 * ((frame % 3) / 2) }}
                aria-live="off"
              >
                {plan.decoys.length ? plan.decoys[Math.min(frame, plan.decoys.length - 1)] : "…"}
              </div>
              <div className="font-mono mt-6 text-[0.62rem] uppercase tracking-[0.2em] text-(--color-brass)">
                tap to reveal
              </div>
            </button>
          ) : (
            /* ---- spun club-season card (finish hidden in ALL modes) ---- */
            <div key={cs.id} className="card card-foil spin-reel overflow-hidden">
              <div className="flex flex-wrap items-baseline justify-between gap-2 px-5 pt-5 sm:px-6">
                <div>
                  <div className="font-mono text-[0.65rem] uppercase tracking-[0.25em] text-(--color-brass)">
                    {cs.competition === "EC" ? "European Cup" : "Champions League"} · {cs.season} · {cs.eraLabel}
                  </div>
                  <h2 className="mt-1 text-3xl font-semibold tracking-tight sm:text-4xl">{cs.clubName}</h2>
                  <p className="font-mono mt-1 text-[0.7rem] text-(--color-chalk-dim)">
                    {cs.country ?? "Europe"} · squad of {cs.playerSeasonIds.length} · pick one immortal
                  </p>
                </div>
                {vis.confidence && <ConfidenceDot label={cs.confidence.label} />}
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
                  {list.map((sp) => (
                    <PlayerRow
                      key={sp.player.id}
                      sp={sp}
                      mode={state.mode}
                      isSelected={selected?.player.id === sp.player.id}
                      onToggle={() => setSelected(selected?.player.id === sp.player.id ? null : sp)}
                      onPlace={place}
                    />
                  ))}
                </ul>
              </div>
            </div>
          )}
          <p className="font-mono text-[0.62rem] uppercase tracking-[0.18em] text-(--color-chalk-faint)">
            no rerolls — the archive gives what it gives. greyed players cannot fit your remaining positions.
          </p>
        </div>

        {/* pitch with current XI */}
        <div className="space-y-3">
          <Pitch
            formation={formation}
            onSlotClick={revealed && selected && !selected.blockedReason ? place : undefined}
            slots={formation.slots.map((slot) => {
              const player = filledBySlot.get(slot.id) ?? null;
              const cs2 = player ? index.clubSeasonById.get(player.clubSeasonId) : null;
              return {
                slot,
                player,
                clubLabel: cs2 ? `${cs2.clubName} ${cs2.season.slice(0, 4)}` : undefined,
                highlight:
                  revealed && !!selected && !selected.blockedReason && selected.eligibleSlots.some((e) => e.slot.id === slot.id),
              };
            })}
          />
          <p className="font-mono text-center text-[0.62rem] uppercase tracking-[0.18em] text-(--color-chalk-faint)">
            {!revealed
              ? "the reel is still spinning"
              : selected
                ? "tap a glowing slot to place " + selected.player.name
                : `${open.length} positions still open`}
          </p>
        </div>
      </div>
    </div>
  );
}

/* ---------------- player row (mode-aware) ---------------- */

function PlayerRow({
  sp,
  mode,
  isSelected,
  onToggle,
  onPlace,
}: {
  sp: SelectablePlayer;
  mode: DraftMode;
  isSelected: boolean;
  onToggle: () => void;
  onPlace: (slot: FormationSlot) => void;
}) {
  const p = sp.player;
  const vis = visibilityFor(mode, "draft");
  return (
    <li>
      <button
        type="button"
        disabled={!!sp.blockedReason}
        aria-disabled={!!sp.blockedReason}
        onClick={onToggle}
        className={`w-full rounded-lg border p-3 text-left transition ${
          sp.blockedReason
            ? "cursor-not-allowed border-(--color-line) opacity-40"
            : isSelected
              ? "border-(--color-brass) bg-(--color-ink-3)"
              : "border-(--color-line) bg-(--color-ink) hover:border-(--color-brass-soft)"
        }`}
        aria-pressed={isSelected}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="truncate font-semibold">
            {p.name}
            {vis.captain && p.captain && <span className="ml-1 text-(--color-brass)" title="captain">©</span>}
          </span>
          {vis.ratings ? (
            <span className="font-mono text-lg text-(--color-brass)">{Math.round(p.ratings.overall)}</span>
          ) : (
            <span className="font-mono text-xs text-(--color-chalk-faint)">{p.pos}</span>
          )}
        </div>
        <div className="font-mono mt-0.5 flex flex-wrap items-center gap-x-2 text-[0.6rem] uppercase tracking-wider text-(--color-chalk-faint)">
          <span className="text-(--color-chalk-dim)">{p.pos}</span>
          {vis.role && p.role !== "squad" && <span>{p.role}</span>}
          {vis.stats && p.finalGoals > 0 && <span className="text-(--color-brass)">{p.finalGoals}g in final</span>}
          {vis.stats && p.seasonGoals !== null && p.seasonGoals > 0 && (
            <span className="text-(--color-brass)">{p.seasonGoals}g in europe</span>
          )}
          {vis.stats && p.seasonApps !== null && <span>{p.seasonApps} euro apps</span>}
          {vis.stats && p.careerFinals > 1 && <span>{p.careerFinals} finals</span>}
          {p.nationality && <span>{p.nationality}</span>}
          {vis.confidence && p.confidence.label !== "high" && (
            <span className="text-(--color-blood)">{p.confidence.label} conf</span>
          )}
        </div>
        {sp.blockedReason && (
          <div className="font-mono mt-1 text-[0.6rem] uppercase tracking-wider text-(--color-blood)">
            {sp.blockedReason}
          </div>
        )}
        {isSelected && (
          <div className="mt-2 space-y-1">
            {vis.ratings && (
              <>
                <RatingBar label="atk" value={p.ratings.attack} />
                <RatingBar label="ctl" value={p.ratings.control} />
                <RatingBar label="def" value={p.ratings.defense} />
                {p.posGroup === "GK" && <RatingBar label="gk" value={p.ratings.goalkeeping} />}
                <RatingBar label="aura" value={p.ratings.uclAura} />
              </>
            )}
            <div className="font-mono pt-1 text-[0.62rem] uppercase tracking-wider text-(--color-chalk-dim)">
              place at:{" "}
              {sp.eligibleSlots
                .slice()
                .sort((a, b) => b.fit - a.fit)
                .map((e) => (
                  <span
                    key={e.slot.id}
                    role="button"
                    tabIndex={0}
                    onClick={(ev) => {
                      ev.stopPropagation();
                      onPlace(e.slot);
                    }}
                    onKeyDown={(ev) => {
                      if (ev.key === "Enter" || ev.key === " ") {
                        ev.preventDefault();
                        ev.stopPropagation();
                        onPlace(e.slot);
                      }
                    }}
                    className={`mr-1 mb-1 inline-block cursor-pointer rounded border px-2 py-0.5 ${
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
                  </span>
                ))}
            </div>
          </div>
        )}
      </button>
    </li>
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
          mode: state.mode,
          formationId: state.formationId,
          draftSeed: state.draftSeed,
          playerSeasonIds: formation.slots.map((s) => bySlot.get(s.id)!),
        },
        index,
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state, index],
  );

  return (
    <div className="space-y-6 pt-2">
      <div className="rise">
        <p className="kicker">the team sheet is signed{state.mode === "hard" ? " · hard mode — all hidden info now revealed" : ""}</p>
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
              <span>data confidence {(profile.avgConfidence * 100).toFixed(0)}%</span>
            </div>
          </div>

          <div className="card rise rise-2 p-5">
            <p className="kicker mb-2">where your immortals came from</p>
            <ul className="space-y-1 text-sm text-(--color-chalk-dim)">
              {[...new Set(state.picks.map((p) => p.clubSeasonId))].map((csId) => {
                const cs = index.clubSeasonById.get(csId)!;
                return (
                  <li key={csId}>
                    — {cs.clubName} {cs.season}:{" "}
                    <span className="text-(--color-chalk-faint)">{cs.category.replace(/_/g, " ")}</span>
                  </li>
                );
              })}
            </ul>
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
        </div>
      </div>
    </div>
  );
}
