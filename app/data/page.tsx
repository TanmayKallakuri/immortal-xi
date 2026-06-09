import fs from "node:fs";
import path from "node:path";
import Link from "next/link";
import type { QualitySummary } from "@/lib/types";

interface FullReport {
  generatedAt: string;
  summary: QualitySummary;
  sources: Array<{
    id: string;
    name: string;
    status: string;
    status_note: string;
    confidence_level: string;
    license_note: string;
    retrieved_at: string | null;
  }>;
  overrides: Array<{
    entity_type: string;
    entity_id: string;
    fields_changed: string;
    reason: string;
    author_note: string;
    date: string;
  }>;
  warnings: Array<{ entity_type: string; entity_id: string; flag_type: string; severity: string; detail: string }>;
}

function loadReport(): FullReport | null {
  try {
    const p = path.join(process.cwd(), "public", "quality-report.json");
    return JSON.parse(fs.readFileSync(p, "utf8")) as FullReport;
  } catch {
    return null;
  }
}

export const metadata = { title: "Data Room — Immortal XI" };

export default function DataPage() {
  const report = loadReport();
  if (!report) {
    return (
      <div className="card p-8">
        <p className="kicker mb-2">data room empty</p>
        <p className="text-(--color-chalk-dim)">
          No quality report found. Run <code className="font-mono">npm run pipeline</code> to ingest, clean, export and report.
        </p>
      </div>
    );
  }
  const s = report.summary;

  const stat = (label: string, value: number | string, warn = false) => (
    <div key={label} className="card p-4">
      <div className={`font-mono text-2xl ${warn && Number(value) > 0 ? "text-(--color-blood)" : "text-(--color-chalk)"}`}>
        {typeof value === "number" ? value.toLocaleString() : value}
      </div>
      <div className="font-mono mt-1 text-[0.6rem] uppercase tracking-[0.18em] text-(--color-chalk-faint)">{label}</div>
    </div>
  );

  return (
    <div className="space-y-10 pt-4">
      <div className="rise">
        <p className="kicker">the data room</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight sm:text-4xl">Every number, audited</h1>
        <p className="mt-2 max-w-2xl text-(--color-chalk-dim)">
          The game runs on a three-layer pipeline: raw source payloads are preserved verbatim, a canonical layer is
          derived with provenance and confidence scoring, and only validated records reach the game. This page is the
          live quality report — regenerated on every <code className="font-mono">npm run pipeline</code>.
        </p>
      </div>

      <section>
        <p className="kicker mb-3">coverage</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {stat("seasons", s.totalSeasons)}
          {stat("clubs", s.totalClubs)}
          {stat("club-seasons", s.totalClubSeasons)}
          {stat("draftable club-seasons", s.draftableClubSeasons)}
          {stat("players", s.totalPlayers)}
          {stat("player-seasons", s.totalPlayerSeasons)}
          {stat("matches", s.totalMatches)}
          {stat("final goals", s.totalGoals)}
        </div>
        <div className="card mt-3 p-4">
          <p className="font-mono mb-2 text-[0.6rem] uppercase tracking-[0.18em] text-(--color-chalk-faint)">
            seasons by decade
          </p>
          <div className="flex items-end gap-2">
            {Object.entries(s.coverageByDecade).map(([decade, n]) => (
              <div key={decade} className="flex-1 text-center">
                <div
                  className="mx-auto w-full rounded-t bg-(--color-grass)"
                  style={{ height: `${n * 8}px`, maxWidth: "3rem" }}
                  title={`${decade}: ${n}`}
                />
                <div className="font-mono mt-1 text-[0.55rem] text-(--color-chalk-faint)">{decade}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section>
        <p className="kicker mb-3">quality + review queue</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {stat("incomplete finalist squads", s.incompleteSquads, true)}
          {stat("missing goalkeepers", s.missingGoalkeepers, true)}
          {stat("inferred positions", s.missingPositions)}
          {stat("duplicate candidates", s.duplicateCandidates)}
          {stat("low-confidence records", s.lowConfidenceRecords)}
          {stat("manual overrides", s.manualOverrides)}
          {stat("blocked sources", s.blockedSources, true)}
          {stat("flag types", Object.keys(s.flagsByType).length)}
        </div>
        <div className="card mt-3 p-5">
          <p className="font-mono mb-2 text-[0.6rem] uppercase tracking-[0.18em] text-(--color-chalk-faint)">
            recommended next cleanup tasks
          </p>
          <ul className="space-y-1.5 text-sm text-(--color-chalk-dim)">
            {s.nextCleanupTasks.map((t) => (
              <li key={t}>— {t}</li>
            ))}
          </ul>
        </div>
      </section>

      <section>
        <p className="kicker mb-3">sources + provenance</p>
        <div className="space-y-2">
          {report.sources.map((src) => (
            <div key={src.id} className="card flex flex-wrap items-center justify-between gap-3 p-4">
              <div className="min-w-0">
                <div className="truncate font-semibold">{src.name}</div>
                <div className="font-mono mt-0.5 text-[0.62rem] uppercase tracking-wider text-(--color-chalk-faint)">
                  {src.license_note} · confidence {src.confidence_level}
                  {src.retrieved_at ? ` · retrieved ${src.retrieved_at.slice(0, 10)}` : ""}
                </div>
                {src.status_note && (
                  <div className="mt-1 text-xs text-(--color-chalk-dim)">{src.status_note}</div>
                )}
              </div>
              <span
                className={`font-mono shrink-0 rounded-full border px-3 py-1 text-[0.62rem] uppercase tracking-wider ${
                  src.status === "ok"
                    ? "border-(--color-grass-bright) text-(--color-grass-bright)"
                    : src.status === "blocked"
                      ? "border-(--color-blood) text-(--color-blood)"
                      : "border-(--color-line) text-(--color-chalk-dim)"
                }`}
              >
                {src.status}
              </span>
            </div>
          ))}
        </div>
      </section>

      <section>
        <p className="kicker mb-3">manual overrides — visible, never silent</p>
        <div className="space-y-2">
          {report.overrides.map((o) => (
            <div key={o.entity_id} className="card p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-mono text-sm text-(--color-brass)">{o.entity_id}</span>
                <span className="font-mono text-[0.62rem] uppercase tracking-wider text-(--color-chalk-faint)">{o.date}</span>
              </div>
              <p className="mt-1 text-sm text-(--color-chalk-dim)">{o.reason}</p>
              <p className="font-mono mt-1 text-[0.62rem] text-(--color-chalk-faint)">
                fields: {o.fields_changed} · {o.author_note}
              </p>
            </div>
          ))}
        </div>
      </section>

      {report.warnings.length > 0 && (
        <section>
          <p className="kicker mb-3">open warnings ({report.warnings.length})</p>
          <div className="card archive-scroll max-h-96 overflow-y-auto p-4">
            <ul className="space-y-1.5">
              {report.warnings.map((w, i) => (
                <li key={i} className="font-mono text-[0.68rem] text-(--color-chalk-dim)">
                  <span className={w.severity === "error" ? "text-(--color-blood)" : "text-(--color-brass)"}>
                    [{w.severity}]
                  </span>{" "}
                  <span className="text-(--color-chalk-faint)">{w.flag_type}</span> · {w.entity_id} — {w.detail}
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      <p className="font-mono text-[0.65rem] uppercase tracking-[0.18em] text-(--color-chalk-faint)">
        report generated {report.generatedAt.slice(0, 19).replace("T", " ")} ·{" "}
        <Link href="/about" className="text-(--color-brass) underline decoration-(--color-line) underline-offset-4">
          how the pipeline works
        </Link>
      </p>
    </div>
  );
}
