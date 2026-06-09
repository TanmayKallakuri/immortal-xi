"use client";

import type { Formation, FormationSlot } from "@/lib/draft/formations";
import type { GamePlayerSeason } from "@/lib/types";

export interface PitchSlotState {
  slot: FormationSlot;
  player: GamePlayerSeason | null;
  highlight?: boolean;
  clubLabel?: string;
}

export function Pitch({
  formation,
  slots,
  onSlotClick,
  compact = false,
}: {
  formation: Formation;
  slots: PitchSlotState[];
  onSlotClick?: (slot: FormationSlot) => void;
  compact?: boolean;
}) {
  return (
    <div
      className="relative w-full overflow-hidden rounded-xl border border-(--color-line)"
      style={{
        aspectRatio: compact ? "3 / 3.4" : "3 / 3.8",
        background:
          "linear-gradient(180deg, #11241a 0%, #0d1c14 48%, #11241a 48.01%, #0d1c14 100%)",
      }}
      aria-label={`Formation ${formation.name}`}
    >
      {/* pitch markings */}
      <svg className="absolute inset-0 h-full w-full opacity-25" viewBox="0 0 100 127" preserveAspectRatio="none" aria-hidden>
        <rect x="2" y="2" width="96" height="123" fill="none" stroke="#ece3cd" strokeWidth="0.45" />
        <line x1="2" y1="63.5" x2="98" y2="63.5" stroke="#ece3cd" strokeWidth="0.45" />
        <circle cx="50" cy="63.5" r="11" fill="none" stroke="#ece3cd" strokeWidth="0.45" />
        <rect x="28" y="2" width="44" height="16" fill="none" stroke="#ece3cd" strokeWidth="0.45" />
        <rect x="28" y="109" width="44" height="16" fill="none" stroke="#ece3cd" strokeWidth="0.45" />
        <rect x="39" y="2" width="22" height="6.5" fill="none" stroke="#ece3cd" strokeWidth="0.45" />
        <rect x="39" y="118.5" width="22" height="6.5" fill="none" stroke="#ece3cd" strokeWidth="0.45" />
      </svg>

      {slots.map(({ slot, player, highlight, clubLabel }) => {
        const interactive = !!onSlotClick;
        return (
          <button
            key={slot.id}
            type="button"
            disabled={!interactive}
            onClick={() => onSlotClick?.(slot)}
            className={`absolute -translate-x-1/2 -translate-y-1/2 text-center transition ${
              interactive ? "cursor-pointer" : "cursor-default"
            }`}
            style={{ left: `${slot.x}%`, top: `${100 - slot.y * 0.92 - 4}%`, width: compact ? "26%" : "23%" }}
            aria-label={player ? `${slot.label}: ${player.name}` : `${slot.label}: empty`}
          >
            <span
              className={`mx-auto flex h-9 w-9 items-center justify-center rounded-full border text-[0.62rem] font-semibold sm:h-10 sm:w-10 ${
                player
                  ? "border-(--color-brass) bg-(--color-ink) text-(--color-brass)"
                  : highlight
                    ? "pulse-brass border-(--color-brass) bg-(--color-ink-3) text-(--color-chalk)"
                    : "border-(--color-line) bg-(--color-ink-2) text-(--color-chalk-faint)"
              } font-mono`}
            >
              {player ? (player.shirt ?? player.pos) : slot.label}
            </span>
            <span
              className={`mt-1 block truncate text-[0.62rem] leading-tight sm:text-[0.7rem] ${
                player ? "text-(--color-chalk)" : "text-(--color-chalk-faint)"
              }`}
            >
              {player ? player.name : slot.label}
            </span>
            {player && clubLabel ? (
              <span className="font-mono block truncate text-[0.52rem] uppercase tracking-wide text-(--color-chalk-faint)">
                {clubLabel}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
