import Link from "next/link";

export const metadata = { title: "About — Immortal XI" };

const sections: Array<{ title: string; body: React.ReactNode }> = [
  {
    title: "What this is",
    body: (
      <>
        Immortal XI is an unofficial, fan-made browser game. You draft a starting eleven from real historical European
        Cup and UEFA Champions League club-seasons — 1955/56 through the latest completed season — and a deterministic
        engine simulates a full modern-format continental campaign for your impossible team. Every finished XI produces
        a share seed that reconstructs the exact team and replays the exact campaign on any machine.
      </>
    ),
  },
  {
    title: "Where the data comes from",
    body: (
      <>
        Historical facts (finals, scores, lineups, scorers, match results) are ingested from public sources: Wikipedia
        final articles and the finals list (CC BY-SA factual records), and the footballcsv open dataset of European Cup
        match results (public domain). Sources that could not be used — UEFA.com (restrictive terms, JS-rendered),
        Kaggle (auth required), FBref (terms restrict scraping) — are registered and visibly marked as blocked in the{" "}
        <Link href="/data" className="text-(--color-brass) underline decoration-(--color-line) underline-offset-4">
          data room
        </Link>
        . Raw payloads are preserved verbatim; canonical records carry source references, retrieval dates, parser
        versions and confidence scores. Missing data becomes a quality flag, never an invention.
      </>
    ),
  },
  {
    title: "What the ratings mean",
    body: (
      <>
        Ratings are game-specific, not official, and not a claim about real ability. They are computed from observed
        evidence in this dataset — role in the final, goals in the final, captaincy, how often a player reached finals
        across their career — and normalized so that eras compete fairly: a 1957 champion&apos;s starter and a 2024
        champion&apos;s starter share the same baseline. Sparse old data lowers a record&apos;s <em>confidence</em>{" "}
        (which widens simulation variance and raises rarity), never its quality. A small set of manual overrides for
        consensus all-time greats is stored separately, with reasons and dates, and shown openly in the data room.
      </>
    ),
  },
  {
    title: "Determinism",
    body: (
      <>
        Draft spins, campaign simulations and head-to-head battles all derive from seeded random streams. The same
        archive key produces the same spin sequence; the same share seed plus the same simulation version produces the
        same campaign result; the same two seeds and battle mode produce the same battle. When simulation logic
        changes, the simulation version is bumped and old seeds are rejected with a clear message rather than silently
        replayed differently.
      </>
    ),
  },
  {
    title: "Limitations",
    body: (
      <>
        The draftable pool currently covers finalist squads (every final from 1956 onward) — semi-finalists and group
        stage squads are a planned extension, and the pipeline already tracks 2,600+ club-seasons of match data to
        support it. Lineup parsing of 70 years of differently-formatted articles is conservative: anything ambiguous is
        flagged for review rather than guessed. Player statistics beyond finals (league goals, full European campaign
        appearances) are not yet ingested, so ratings lean on finals evidence and documented overrides.
      </>
    ),
  },
  {
    title: "Legal + identity",
    body: (
      <>
        This project has no affiliation with UEFA, any club, or any player. It uses no official branding, no club
        crests, no player photographs — the visual identity is original: typography, abstract pitch geometry and
        generated styling. Club and player names appear solely as historical facts. Underlying factual data remains
        attributable to its sources; this game&apos;s derived ratings and simulations are original work and entirely
        fictional.
      </>
    ),
  },
];

export default function AboutPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-8 pt-4">
      <div className="rise">
        <p className="kicker">about + provenance</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight sm:text-4xl">An honest archive game</h1>
      </div>
      {sections.map((s, i) => (
        <section key={s.title} className={`card card-foil rise rise-${(i % 5) + 1} p-6`}>
          <h2 className="text-lg font-semibold text-(--color-brass)">{s.title}</h2>
          <p className="mt-2 leading-relaxed text-(--color-chalk-dim)">{s.body}</p>
        </section>
      ))}
      <p className="font-mono pb-4 text-[0.65rem] uppercase tracking-[0.18em] text-(--color-chalk-faint)">
        full docs in the repository: data pipeline, rating model, simulation model, decision log.
      </p>
    </div>
  );
}
