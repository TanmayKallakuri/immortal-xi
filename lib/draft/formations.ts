/** Formations, slot geometry, and position-fit rules. */
import type { PosGroup } from "../types";

export interface FormationSlot {
  id: string; // unique within formation, e.g. "CB1"
  label: string; // shown on the pitch
  group: PosGroup;
  x: number; // 0 (left) .. 100 (right)
  y: number; // 0 (own goal) .. 100 (opponent goal)
}

export interface Formation {
  id: string;
  name: string;
  tactic: string;
  slots: FormationSlot[];
}

const gk = { id: "GK", label: "GK", group: "GK" as const, x: 50, y: 6 };

function d(id: string, label: string, x: number, y: number): FormationSlot {
  return { id, label, group: "DF", x, y };
}
function m(id: string, label: string, x: number, y: number): FormationSlot {
  return { id, label, group: "MF", x, y };
}
function f(id: string, label: string, x: number, y: number): FormationSlot {
  return { id, label, group: "FW", x, y };
}

export const FORMATIONS: Formation[] = [
  {
    id: "433",
    name: "4-3-3",
    tactic: "Balanced control with wide forwards",
    slots: [
      gk,
      d("RB", "RB", 84, 24), d("CB1", "CB", 62, 20), d("CB2", "CB", 38, 20), d("LB", "LB", 16, 24),
      m("CM1", "CM", 70, 48), m("CM2", "CM", 50, 42), m("CM3", "CM", 30, 48),
      f("RW", "RW", 80, 76), f("ST", "ST", 50, 84), f("LW", "LW", 20, 76),
    ],
  },
  {
    id: "442",
    name: "4-4-2",
    tactic: "Classic two-striker pressure",
    slots: [
      gk,
      d("RB", "RB", 84, 24), d("CB1", "CB", 62, 20), d("CB2", "CB", 38, 20), d("LB", "LB", 16, 24),
      m("RM", "RM", 84, 52), m("CM1", "CM", 62, 46), m("CM2", "CM", 38, 46), m("LM", "LM", 16, 52),
      f("ST1", "ST", 60, 82), f("ST2", "ST", 40, 82),
    ],
  },
  {
    id: "4231",
    name: "4-2-3-1",
    tactic: "Double pivot, creative trident",
    slots: [
      gk,
      d("RB", "RB", 84, 24), d("CB1", "CB", 62, 20), d("CB2", "CB", 38, 20), d("LB", "LB", 16, 24),
      m("DM1", "DM", 60, 40), m("DM2", "DM", 40, 40),
      m("RAM", "RAM", 78, 62), m("CAM", "CAM", 50, 64), m("LAM", "LAM", 22, 62),
      f("ST", "ST", 50, 85),
    ],
  },
  {
    id: "424",
    name: "4-2-4",
    tactic: "All-out 1960s attacking width",
    slots: [
      gk,
      d("RB", "RB", 84, 24), d("CB1", "CB", 62, 20), d("CB2", "CB", 38, 20), d("LB", "LB", 16, 24),
      m("CM1", "CM", 60, 46), m("CM2", "CM", 40, 46),
      f("RW", "RW", 84, 76), f("ST1", "ST", 60, 84), f("ST2", "ST", 40, 84), f("LW", "LW", 16, 76),
    ],
  },
  {
    id: "343",
    name: "3-4-3",
    tactic: "Brave back three, relentless wings",
    slots: [
      gk,
      d("CB1", "CB", 72, 20), d("CB2", "CB", 50, 18), d("CB3", "CB", 28, 20),
      m("RM", "RWB", 86, 50), m("CM1", "CM", 60, 44), m("CM2", "CM", 40, 44), m("LM", "LWB", 14, 50),
      f("RW", "RW", 76, 78), f("ST", "ST", 50, 85), f("LW", "LW", 24, 78),
    ],
  },
  {
    id: "352",
    name: "3-5-2",
    tactic: "Midfield swarm, twin spearheads",
    slots: [
      gk,
      d("CB1", "CB", 72, 20), d("CB2", "CB", 50, 18), d("CB3", "CB", 28, 20),
      m("RWB", "RWB", 88, 52), m("CM1", "CM", 66, 46), m("CM2", "CM", 50, 40), m("CM3", "CM", 34, 46), m("LWB", "LWB", 12, 52),
      f("ST1", "ST", 60, 82), f("ST2", "ST", 40, 82),
    ],
  },
  {
    id: "532",
    name: "5-3-2",
    tactic: "Fortress first, counter later",
    slots: [
      gk,
      d("RWB", "RWB", 88, 30), d("CB1", "CB", 68, 18), d("CB2", "CB", 50, 16), d("CB3", "CB", 32, 18), d("LWB", "LWB", 12, 30),
      m("CM1", "CM", 66, 50), m("CM2", "CM", 50, 44), m("CM3", "CM", 34, 50),
      f("ST1", "ST", 60, 80), f("ST2", "ST", 40, 80),
    ],
  },
  {
    id: "541",
    name: "5-4-1",
    tactic: "The defensive wall",
    slots: [
      gk,
      d("RWB", "RWB", 88, 28), d("CB1", "CB", 68, 18), d("CB2", "CB", 50, 16), d("CB3", "CB", 32, 18), d("LWB", "LWB", 12, 28),
      m("RM", "RM", 82, 52), m("CM1", "CM", 60, 46), m("CM2", "CM", 40, 46), m("LM", "LM", 18, 52),
      f("ST", "ST", 50, 82),
    ],
  },
];

export const formationById = (id: string): Formation | undefined => FORMATIONS.find((x) => x.id === id);

/**
 * Position fit of a player group in a slot. 1 = natural. GK is hard-gated:
 * only goalkeepers in goal, never a goalkeeper outfield.
 */
export function positionFit(playerGroup: PosGroup, slot: FormationSlot): number {
  if (slot.group === "GK") return playerGroup === "GK" ? 1 : 0;
  if (playerGroup === "GK") return 0;
  if (playerGroup === slot.group) return 1;
  const adj: Record<string, number> = {
    "DF:MF": 0.85, "MF:DF": 0.85,
    "MF:FW": 0.85, "FW:MF": 0.85,
    "DF:FW": 0.7, "FW:DF": 0.7,
  };
  return adj[`${playerGroup}:${slot.group}`] ?? 0.7;
}

/** Extra nuance for raw historical codes: wingers fit wide slots, etc. */
export function fineFit(playerPos: string, slot: FormationSlot): number {
  const wideF = ["RW", "LW"];
  const wideM = ["RM", "LM", "RWB", "LWB", "RAM", "LAM"];
  const p = playerPos.toUpperCase();
  const wingerCodes = ["OR", "OL", "RW", "LW", "RM", "LM"];
  const strikerCodes = ["CF", "ST", "SS", "IR", "IL", "IF", "FW"];
  const fullbackCodes = ["RB", "LB", "WB", "RWB", "LWB", "FB"];
  const centreBackCodes = ["CB", "CH", "SW", "DF"];
  if (wideF.includes(slot.id.replace(/\d/g, "")) && wingerCodes.includes(p)) return 1.04;
  if (slot.id.startsWith("ST") && strikerCodes.includes(p)) return 1.04;
  if (wideM.includes(slot.id.replace(/\d/g, "")) && (wingerCodes.includes(p) || fullbackCodes.includes(p))) return 1.03;
  if (slot.id.startsWith("CB") && centreBackCodes.includes(p)) return 1.03;
  if ((slot.id === "RB" || slot.id === "LB") && fullbackCodes.includes(p)) return 1.04;
  return 1;
}
