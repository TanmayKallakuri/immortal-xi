import Link from "next/link";
import { loadGameData } from "@/lib/data/game-data";

export default async function Home() {
  const index = await loadGameData();
  const q = index.data.quality;
  const eras = Object.keys(q.coverageByDecade).length;

  return (
    <div className="space-y-14 pt-6 sm:pt-12">
      <section className="rise">
        <p className="kicker mb-4">European Cup · Champions League · 1955/56 → today</p>
        <h1 className="max-w-3xl text-4xl leading-[1.05] font-semibold tracking-tight sm:text-6xl">
          Build the XI that <span className="text-(--color-brass) italic">history never allowed.</span>
        </h1>
        <p className="mt-5 max-w-2xl text-base leading-relaxed text-(--color-chalk-dim) sm:text-lg">
          Eleven spins of the archive. Each one surfaces a real club-season — Reims 1956, Celtic 1967, Steaua 1986,
          Ajax 1995 — and you take exactly one player from that actual squad. Then your impossible team enters a full
          modern Champions League campaign. Win it, and the seed proves it forever.
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <Link href="/draft" className="btn-brass inline-block">
            Start a Solo Run
          </Link>
          <Link href="/h2h" className="btn-ghost inline-block">
            Battle Two Seeds
          </Link>
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-3">
        {[
          {
            n: "01",
            t: "Spin the archive",
            d: "Weighted, deterministic spins across 70 seasons of finalists — dynasties, cult heroes and one-final wonders.",
          },
          {
            n: "02",
            t: "Pick one immortal",
            d: "Real squads, real positions, season-specific ratings with visible data confidence. One player per spin.",
          },
          {
            n: "03",
            t: "Survive the campaign",
            d: "League phase, knockout ladder, extra time, penalties. Same seed, same story — share it and let others verify.",
          },
        ].map((s, i) => (
          <div key={s.n} className={`card card-foil rise rise-${i + 1} p-6`}>
            <div className="font-mono text-xs text-(--color-brass)">{s.n}</div>
            <h3 className="mt-2 text-lg font-semibold">{s.t}</h3>
            <p className="mt-2 text-sm leading-relaxed text-(--color-chalk-dim)">{s.d}</p>
          </div>
        ))}
      </section>

      <section className="card rise rise-3 p-6 sm:p-8">
        <p className="kicker mb-5">The archive, in numbers</p>
        <div className="font-mono grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-4">
          {[
            [q.totalSeasons, "seasons covered"],
            [q.draftableClubSeasons, "draftable club-seasons"],
            [q.totalPlayerSeasons, "player-seasons rated"],
            [q.totalMatches, "real matches ingested"],
            [q.totalClubs, "clubs canonicalized"],
            [q.totalPlayers, "players resolved"],
            [eras, "decades of football"],
            [q.manualOverrides, "documented overrides"],
          ].map(([v, l]) => (
            <div key={String(l)}>
              <div className="text-2xl text-(--color-chalk) sm:text-3xl">{Number(v).toLocaleString()}</div>
              <div className="mt-1 text-[0.62rem] uppercase tracking-[0.18em] text-(--color-chalk-faint)">{l}</div>
            </div>
          ))}
        </div>
        <p className="ticket-edge font-mono mt-6 pt-4 text-[0.65rem] uppercase tracking-[0.18em] text-(--color-chalk-faint)">
          every number above is derived from cited public sources — inspect them in the{" "}
          <Link href="/data" className="text-(--color-brass) underline decoration-(--color-line) underline-offset-4">
            data room
          </Link>
        </p>
      </section>
    </div>
  );
}
