"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { indexGameData, type GameDataIndex } from "@/lib/data/game-data";

interface Ctx {
  index: GameDataIndex | null;
  error: string | null;
}

const GameDataContext = createContext<Ctx>({ index: null, error: null });

let memo: GameDataIndex | null = null;

export function GameDataProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<Ctx>({ index: memo, error: null });

  useEffect(() => {
    if (memo) return;
    let alive = true;
    fetch("/game-data.json")
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((raw) => {
        memo = indexGameData(raw);
        if (alive) setState({ index: memo, error: null });
      })
      .catch((e) => alive && setState({ index: null, error: String(e) }));
    return () => {
      alive = false;
    };
  }, []);

  return <GameDataContext.Provider value={state}>{children}</GameDataContext.Provider>;
}

export function useGameData(): Ctx {
  return useContext(GameDataContext);
}

export function ArchiveLoading({ label = "Opening the archive…" }: { label?: string }) {
  return (
    <div className="card flex items-center justify-center gap-3 p-12">
      <span className="pulse-brass inline-block h-2.5 w-2.5 rounded-full bg-(--color-brass)" />
      <span className="font-mono text-xs uppercase tracking-[0.25em] text-(--color-chalk-dim)">{label}</span>
    </div>
  );
}
