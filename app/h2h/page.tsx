"use client";

import { Suspense, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { GameDataProvider, useGameData, ArchiveLoading } from "@/components/GameDataProvider";
import { Pitch } from "@/components/Pitch";
import { CompareBar } from "@/components/Bars";
import { decodeSeed, type SeedDecodeResult } from "@/lib/draft/seed";
import { resolveSeedInput, localStorageRegistry, type CodeRegistry } from "@/lib/draft/code";
import { formationById } from "@/lib/draft/formations";
import { SIM_VERSION } from "@/lib/simulation/version";
import {
  buildSide,
  simulateH2h,
  BATTLE_MODE_LABEL,
  type BattleMode,
  type H2hResult,
  type H2hSide,
} from "@/lib/simulation/h2h";
import type { GameDataIndex } from "@/lib/data/game-data";

export default function H2hPage() {
  return (
    <GameDataProvider>
      <Suspense fallback={<ArchiveLoading />}>
        <H2hInner />
      </Suspense>
    </GameDataProvider>
  );
}

/** Accepts a 6-7 char compact code (resolved on this device) or a full seed. */
function decodeInput(value: string, index: GameDataIndex, registry: CodeRegistry): SeedDecodeResult | null {
  const t = value.trim();
  if (!t) return null;
  const r = resolveSeedInput(t, registry);
  if (r.error) return { ok: false, error: r.error };
  if (!r.seed) return null;
  return decodeSeed(r.seed, index, SIM_VERSION);
}

function SeedInput({
  label,
  value,
  onChange,
  index,
  registry,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  index: GameDataIndex;
  registry: CodeRegistry;
}) {
  const state = useMemo(() => decodeInput(value, index, registry), [value, index, registry]);

  return (
    <div className="card card-foil p-5">
      <label className="block">
        <span className="kicker">{label}</span>
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="paste a share code (e.g. K7M2XQ) or a full seed (IX2.…)"
          rows={3}
          className="font-mono mt-2 w-full resize-none rounded-md border border-(--color-line) bg-(--color-ink) px-3 py-2.5 text-xs leading-relaxed text-(--color-chalk) placeholder:text-(--color-chalk-faint)"
        />
      </label>
      {state && !state.ok && (
        <p className="font-mono mt-2 text-[0.65rem] uppercase tracking-wider text-(--color-blood)">✗ {state.error}</p>
      )}
      {state?.ok && (
        <div className="mt-3">
          <p className="font-mono text-[0.65rem] uppercase tracking-wider text-(--color-grass-bright)">
            ✓ valid · {formationById(state.payload.formationId)?.name} ·{" "}
            {state.payload.mode === "hard" ? "hard mode" : "classic"} · key {state.payload.draftSeed}
          </p>
          <p className="mt-1 truncate text-xs text-(--color-chalk-dim)">
            {state.players.map((p) => p.name).join(" · ")}
          </p>
        </div>
      )}
    </div>
  );
}

function H2hInner() {
  const { index, error } = useGameData();
  const params = useSearchParams();
  const [seedA, setSeedA] = useState(params.get("a") ?? "");
  const [seedB, setSeedB] = useState(params.get("b") ?? "");
  const [mode, setMode] = useState<BattleMode>("final");
  const [battle, setBattle] = useState<{ result: H2hResult; a: H2hSide; b: H2hSide } | null>(null);
  const [copied, setCopied] = useState(false);
  const registry = useMemo(() => localStorageRegistry(), []);

  if (error) return <ArchiveLoading label={`archive error: ${error}`} />;
  if (!index) return <ArchiveLoading />;

  const decA = decodeInput(seedA, index, registry);
  const decB = decodeInput(seedB, index, registry);
  const ready = decA?.ok && decB?.ok;

  const fight = () => {
    if (!decA?.ok || !decB?.ok) return;
    const a = buildSide("Alpha XI", decA.payload, decA.players, index);
    const b = buildSide("Beta XI", decB.payload, decB.players, index);
    setBattle({ result: simulateH2h(a, b, mode), a, b });
  };

  return (
    <div className="space-y-8 pt-2">
      <div className="rise">
        <p className="kicker">seed battle</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight sm:text-4xl">Two XIs enter. One legend leaves.</h1>
        <p className="mt-2 max-w-2xl text-(--color-chalk-dim)">
          Paste two completed draft seeds. The engine reconstructs both teams exactly and settles it deterministically —
          the same two seeds and mode always produce the same battle, on anyone&apos;s machine.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <SeedInput label="code a — alpha xi" value={seedA} onChange={setSeedA} index={index} registry={registry} />
        <SeedInput label="code b — beta xi" value={seedB} onChange={setSeedB} index={index} registry={registry} />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="font-mono flex flex-wrap gap-1 text-[0.7rem]" role="radiogroup" aria-label="Battle format">
          {(Object.keys(BATTLE_MODE_LABEL) as BattleMode[]).map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={mode === m}
              onClick={() => {
                setMode(m);
                setBattle(null);
              }}
              className={`rounded border px-3 py-2 uppercase tracking-wider transition ${
                mode === m
                  ? "border-(--color-brass) bg-(--color-ink-3) text-(--color-brass)"
                  : "border-(--color-line) text-(--color-chalk-dim) hover:text-(--color-chalk)"
              }`}
            >
              {BATTLE_MODE_LABEL[m]}
            </button>
          ))}
        </div>
        <button type="button" className="btn-brass" disabled={!ready} onClick={fight}>
          Simulate the battle →
        </button>
      </div>

      {battle && decA?.ok && decB?.ok && (
        <div className="space-y-6">
          {/* verdict */}
          <section className="card card-foil rise p-6 text-center sm:p-8">
            <p className="kicker">{BATTLE_MODE_LABEL[battle.result.mode]} · battle {battle.result.battleId} · sim v{battle.result.simVersion}</p>
            <h2 className="mt-3 text-3xl font-semibold sm:text-5xl">
              <span className={battle.result.winner === 0 ? "text-(--color-brass)" : "text-(--color-chalk-dim)"}>Alpha</span>
              <span className="font-mono mx-4 text-(--color-chalk)">
                {battle.result.aggregate[0]}–{battle.result.aggregate[1]}
              </span>
              <span className={battle.result.winner === 1 ? "text-(--color-brass)" : "text-(--color-chalk-dim)"}>Beta</span>
            </h2>
            <p className="font-mono mt-2 text-xs uppercase tracking-[0.2em] text-(--color-chalk-dim)">
              {battle.result.mode === "best-of-7" ? "series wins" : "goals"} ·{" "}
              {battle.result.winner === 0 ? "Alpha XI takes it" : "Beta XI takes it"}
              {battle.result.pens ? ` · penalties ${battle.result.pens[0]}–${battle.result.pens[1]}` : ""}
            </p>
            <div className="mt-5 flex justify-center">
              <button
                type="button"
                className="btn-ghost"
                onClick={async () => {
                  const text = [
                    `IMMORTAL XI — head-to-head ${BATTLE_MODE_LABEL[battle.result.mode]}`,
                    `Result: Alpha ${battle.result.aggregate[0]}–${battle.result.aggregate[1]} Beta (battle ${battle.result.battleId}, sim v${battle.result.simVersion})`,
                    `Seed A: ${seedA.trim()}`,
                    `Seed B: ${seedB.trim()}`,
                  ].join("\n");
                  await navigator.clipboard.writeText(text);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1600);
                }}
              >
                {copied ? "Copied ✓" : "Copy battle result"}
              </button>
            </div>
          </section>

          {/* pitches */}
          <div className="grid gap-5 sm:grid-cols-2">
            {([
              ["Alpha XI", decA, battle.a],
              ["Beta XI", decB, battle.b],
            ] as const).map(([name, dec, side]) => {
              const formation = formationById(dec.payload.formationId)!;
              return (
                <div key={name} className="space-y-2">
                  <p className="kicker">
                    {name} · {formation.name}
                  </p>
                  <Pitch
                    compact
                    formation={formation}
                    slots={formation.slots.map((slot, i) => {
                      const player = dec.players[i];
                      const cs = index.clubSeasonById.get(player.clubSeasonId);
                      return { slot, player, clubLabel: cs ? `${cs.clubName} ${cs.season.slice(0, 4)}` : undefined };
                    })}
                  />
                  <p className="font-mono text-center text-[0.62rem] uppercase tracking-wider text-(--color-chalk-faint)">
                    strength {side.profile.strength.toFixed(1)} · chemistry {side.profile.chemistry.toFixed(1)}
                  </p>
                </div>
              );
            })}
          </div>

          {/* comparison */}
          <section className="card p-6">
            <p className="kicker mb-4">tactical comparison</p>
            <div className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
              {battle.result.tacticalNotes.map((n) => (
                <div key={n.category}>
                  <CompareBar label={n.category} a={n.aValue} b={n.bValue} />
                  <p className="mt-1 text-xs text-(--color-chalk-faint)">{n.text}</p>
                </div>
              ))}
            </div>
          </section>

          {/* timeline */}
          <section className="card p-6">
            <p className="kicker mb-4">match timeline</p>
            <div className="space-y-4">
              {battle.result.legs.map((leg) => (
                <div key={leg.label}>
                  <div className="mb-2 flex items-baseline justify-between">
                    <h4 className="text-sm font-semibold text-(--color-chalk)">{leg.label}</h4>
                    <span className="font-mono text-sm text-(--color-brass)">
                      {leg.aGoals}–{leg.bGoals}
                      {leg.result.pens ? ` (pens)` : ""}
                    </span>
                  </div>
                  <ul className="space-y-1">
                    {leg.result.events.length === 0 && (
                      <li className="text-xs text-(--color-chalk-faint)">Cagey. Chances at a premium.</li>
                    )}
                    {leg.result.events.map((e, i) => (
                      <li key={i} className="text-xs text-(--color-chalk-dim)">
                        <span className="font-mono mr-2 w-8 text-(--color-brass)">{e.minute}&apos;</span>
                        <span className="font-mono mr-2 text-[0.6rem] uppercase text-(--color-chalk-faint)">
                          [{e.side === 0 ? "A" : "B"}]
                        </span>
                        {e.text}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
