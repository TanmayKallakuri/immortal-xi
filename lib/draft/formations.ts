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
 * Role-aware position eligibility.
 *
 * Slots are classified into seven classes; each historical position code
 * maps to the classes it can cover, with fit penalties for secondary roles.
 * A fit of 0 means INELIGIBLE — the draft engine disables such players and
 * the UI greys them out with a reason. GK is hard-gated both ways.
 */
export type SlotClass = "GK" | "DF_C" | "DF_W" | "MF_C" | "MF_W" | "FW_C" | "FW_W";

const WIDE_DF = new Set(["RB", "LB", "RWB", "LWB"]);
const WIDE_MF = new Set(["RM", "LM", "RWB", "LWB", "RAM", "LAM"]);
const WIDE_FW = new Set(["RW", "LW"]);

export function slotClassOf(slot: FormationSlot): SlotClass {
  if (slot.group === "GK") return "GK";
  const id = slot.id.replace(/\d+$/, "");
  if (slot.group === "DF") return WIDE_DF.has(slot.id) || WIDE_DF.has(id) ? "DF_W" : "DF_C";
  if (slot.group === "MF") return WIDE_MF.has(slot.id) || WIDE_MF.has(id) ? "MF_W" : "MF_C";
  return WIDE_FW.has(slot.id) || WIDE_FW.has(id) ? "FW_W" : "FW_C";
}

type FitMap = Partial<Record<SlotClass, number>>;

/** position code -> eligible slot classes with fit (1 = natural) */
const CODE_FITS: Record<string, FitMap> = {
  GK: { GK: 1 },
  // centre backs (incl. WM-era centre half / sweeper)
  CB: { DF_C: 1, DF_W: 0.82, MF_C: 0.78 },
  SW: { DF_C: 1, DF_W: 0.8, MF_C: 0.8 },
  CH: { DF_C: 1, DF_W: 0.8, MF_C: 0.85 },
  DF: { DF_C: 1, DF_W: 0.92, MF_C: 0.78 }, // generic squad-list code
  // full backs / wing backs
  RB: { DF_W: 1, DF_C: 0.85, MF_W: 0.9 },
  LB: { DF_W: 1, DF_C: 0.85, MF_W: 0.9 },
  FB: { DF_W: 1, DF_C: 0.85, MF_W: 0.9 },
  WB: { DF_W: 1, DF_C: 0.82, MF_W: 0.95 },
  RWB: { DF_W: 1, DF_C: 0.82, MF_W: 0.95 },
  LWB: { DF_W: 1, DF_C: 0.82, MF_W: 0.95 },
  // central midfield (incl. WM-era half backs)
  DM: { MF_C: 1, DF_C: 0.85, MF_W: 0.85 },
  CM: { MF_C: 1, MF_W: 0.88, DF_C: 0.78 },
  MF: { MF_C: 1, MF_W: 0.9, DF_C: 0.78 }, // generic squad-list code
  RH: { MF_C: 1, MF_W: 0.9, DF_C: 0.8 },
  LH: { MF_C: 1, MF_W: 0.9, DF_C: 0.8 },
  WH: { MF_C: 1, MF_W: 0.9, DF_C: 0.8 },
  // attacking midfield / second striker
  AM: { MF_C: 1, MF_W: 0.9, FW_C: 0.88, FW_W: 0.85 },
  CAM: { MF_C: 1, MF_W: 0.9, FW_C: 0.88, FW_W: 0.85 },
  SS: { FW_C: 0.95, MF_C: 0.92, FW_W: 0.88 },
  // wide midfield
  RM: { MF_W: 1, MF_C: 0.88, FW_W: 0.9 },
  LM: { MF_W: 1, MF_C: 0.88, FW_W: 0.9 },
  // wingers (incl. WM-era outside forwards)
  OR: { FW_W: 1, FW_C: 0.85, MF_W: 0.92 },
  OL: { FW_W: 1, FW_C: 0.85, MF_W: 0.92 },
  RW: { FW_W: 1, FW_C: 0.85, MF_W: 0.92 },
  LW: { FW_W: 1, FW_C: 0.85, MF_W: 0.92 },
  // inside forwards (WM-era creators)
  IR: { FW_C: 0.95, FW_W: 0.9, MF_C: 0.85 },
  IL: { FW_C: 0.95, FW_W: 0.9, MF_C: 0.85 },
  IF: { FW_C: 0.95, FW_W: 0.9, MF_C: 0.85 },
  // strikers
  CF: { FW_C: 1, FW_W: 0.85 },
  ST: { FW_C: 1, FW_W: 0.85 },
  FW: { FW_C: 1, FW_W: 0.95 }, // generic squad-list code
};

const GROUP_FALLBACK: Record<PosGroup, FitMap> = {
  GK: { GK: 1 },
  DF: { DF_C: 0.9, DF_W: 0.9 },
  MF: { MF_C: 0.9, MF_W: 0.9 },
  FW: { FW_C: 0.9, FW_W: 0.9 },
};

export function fitMapFor(playerPos: string, playerGroup: PosGroup): FitMap {
  if (playerGroup === "GK") return { GK: 1 }; // keepers never play outfield
  const byCode = CODE_FITS[playerPos.toUpperCase().trim()];
  return byCode && !byCode.GK ? byCode : GROUP_FALLBACK[playerGroup];
}

/** Fit of a player in a slot; 0 = ineligible. */
export function slotFit(playerPos: string, playerGroup: PosGroup, slot: FormationSlot): number {
  const cls = slotClassOf(slot);
  if (cls === "GK") return playerGroup === "GK" ? 1 : 0;
  if (playerGroup === "GK") return 0;
  return fitMapFor(playerPos, playerGroup)[cls] ?? 0;
}

/**
 * Why a player cannot be placed right now, or null if at least one open
 * slot accepts them. Reasons are user-facing.
 */
export function ineligibleReason(
  playerPos: string,
  playerGroup: PosGroup,
  openSlots: FormationSlot[],
): string | null {
  if (openSlots.some((s) => slotFit(playerPos, playerGroup, s) > 0)) return null;
  if (playerGroup === "GK") return "Goalkeeper already selected";
  const classes = Object.keys(fitMapFor(playerPos, playerGroup)) as SlotClass[];
  const families = new Set(classes.map((c) => c.split("_")[0]));
  if (families.size === 1) {
    const fam = [...families][0];
    if (fam === "FW") return "Forward slots full";
    if (fam === "MF") return "Midfield slots full";
    if (fam === "DF") return "Defensive slots full";
  }
  return "No compatible slot left";
}
