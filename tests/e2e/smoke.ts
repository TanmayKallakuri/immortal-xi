/**
 * E2E smoke test:  npm run test:e2e   (requires `npm run build` first)
 *
 * 1. Engine-level end-to-end: complete a full draft -> encode seed ->
 *    simulate campaign -> decode seed -> re-simulate -> identical result.
 * 2. H2H end-to-end with two valid seeds in all three battle modes.
 * 3. HTTP smoke: starts the production server and verifies every screen
 *    renders (200 + expected markers) plus the game-data payload.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { loadGameData } from "../../lib/data/game-data";
import { newDraft, spin, applyPick } from "../../lib/draft/engine";
import { encodeSeed, decodeSeed, type SeedPayload } from "../../lib/draft/seed";
import { formationById } from "../../lib/draft/formations";
import { SIM_VERSION } from "../../lib/simulation/version";
import { simulateCampaign } from "../../lib/simulation/campaign";
import { buildSide, simulateH2h } from "../../lib/simulation/h2h";

const PORT = 3211;
let failures = 0;

function check(name: string, ok: boolean, detail = "") {
  if (ok) console.log(`  ✓ ${name}`);
  else {
    failures++;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function engineFlow(): Promise<{ seedA: string; seedB: string }> {
  console.log("\n[1/3] engine end-to-end");
  const index = await loadGameData();

  const fullDraft = (key: string, formationId: string): SeedPayload => {
    let state = newDraft(key, formationId);
    while (state.round < 11) {
      const s = spin(state, index);
      const pick = s.selectable
        .filter((p) => !p.blockedReason)
        .sort((a, b) => b.player.ratings.overall - a.player.ratings.overall || a.player.id.localeCompare(b.player.id))[0];
      const slot = pick.eligibleSlots.slice().sort((a, b) => b.fit - a.fit || a.slot.id.localeCompare(b.slot.id))[0].slot;
      state = applyPick(state, s.clubSeason, pick.player.id, slot.id, index);
    }
    const formation = formationById(formationId)!;
    const bySlot = new Map(state.picks.map((p) => [p.slotId, p.playerSeasonId]));
    return {
      dataVersion: index.data.dataVersion,
      simVersion: SIM_VERSION,
      formationId,
      draftSeed: key,
      playerSeasonIds: formation.slots.map((s) => bySlot.get(s.id)!),
    };
  };

  const payloadA = fullDraft("e2e-alpha", "433");
  const seedA = encodeSeed(payloadA, index);
  const decA = decodeSeed(seedA, index, SIM_VERSION);
  check("draft completes and seed round-trips", decA.ok, decA.ok ? "" : decA.error);
  if (!decA.ok) throw new Error("seed decode failed");

  const c1 = simulateCampaign(decA.payload, decA.players, index);
  const c2 = simulateCampaign(decA.payload, decA.players, index);
  check("campaign simulates deterministically", JSON.stringify(c1) === JSON.stringify(c2));
  check("campaign reaches a final outcome", c1.outcomeLabel.length > 0, c1.outcomeLabel);
  check("league phase has 8 matches + 36-team table", c1.leagueMatches.length === 8 && c1.table.length === 36);

  const payloadB = fullDraft("e2e-beta", "352");
  const seedB = encodeSeed(payloadB, index);
  const decB = decodeSeed(seedB, index, SIM_VERSION);
  check("second seed valid", decB.ok);
  if (!decB.ok) throw new Error("seed B decode failed");

  console.log("\n[2/3] head-to-head end-to-end");
  for (const mode of ["final", "two-legged", "best-of-7"] as const) {
    const a = buildSide("Alpha XI", decA.payload, decA.players, index);
    const b = buildSide("Beta XI", decB.payload, decB.players, index);
    const r1 = simulateH2h(a, b, mode);
    const r2 = simulateH2h(a, b, mode);
    check(`h2h ${mode} deterministic with a winner`, JSON.stringify(r1) === JSON.stringify(r2) && (r1.winner === 0 || r1.winner === 1));
  }
  return { seedA, seedB };
}

async function httpSmoke(seedA: string) {
  console.log("\n[3/3] http smoke (production server)");
  const server: ChildProcess = spawn(
    process.platform === "win32" ? "npx.cmd" : "npx",
    ["next", "start", "-p", String(PORT)],
    { cwd: process.cwd(), stdio: "pipe", shell: process.platform === "win32" },
  );
  const ready = new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("server start timeout")), 60000);
    server.stdout?.on("data", (d: Buffer) => {
      if (d.toString().includes("Ready")) {
        clearTimeout(t);
        resolve();
      }
    });
    server.on("exit", (code) => reject(new Error(`server exited early (${code})`)));
  });

  try {
    await ready;
    const base = `http://localhost:${PORT}`;
    const pages: Array<[string, string]> = [
      ["/", "Immortal"],
      ["/draft", "Immortal"],
      [`/result?seed=${encodeURIComponent(seedA)}`, "Immortal"],
      ["/h2h", "Immortal"],
      ["/data", "Data"],
      ["/about", "archive"],
      ["/game-data.json", "dataVersion"],
      ["/quality-report.json", "summary"],
    ];
    for (const [route, marker] of pages) {
      try {
        const res = await fetch(base + route);
        const text = await res.text();
        check(`GET ${route.slice(0, 50)}`, res.status === 200 && text.includes(marker), `status ${res.status}`);
      } catch (e) {
        check(`GET ${route}`, false, String(e));
      }
    }
  } finally {
    if (process.platform === "win32" && server.pid) {
      spawn("taskkill", ["/PID", String(server.pid), "/T", "/F"], { shell: true });
    } else {
      server.kill("SIGTERM");
    }
  }
}

async function main() {
  const { seedA } = await engineFlow();
  await httpSmoke(seedA);
  console.log(failures === 0 ? "\nE2E SMOKE: ALL PASSED" : `\nE2E SMOKE: ${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
