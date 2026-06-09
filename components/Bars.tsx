"use client";

export function RatingBar({ label, value, max = 99 }: { label: string; value: number; max?: number }) {
  return (
    <div className="flex items-center gap-2">
      <span className="font-mono w-14 shrink-0 text-[0.6rem] uppercase tracking-wider text-(--color-chalk-faint)">
        {label}
      </span>
      <div className="rating-track flex-1">
        <div className="rating-fill" style={{ width: `${Math.min(100, (value / max) * 100)}%` }} />
      </div>
      <span className="font-mono w-7 shrink-0 text-right text-[0.7rem] text-(--color-chalk)">
        {Math.round(value)}
      </span>
    </div>
  );
}

export function ConfidenceDot({ label }: { label: "high" | "medium" | "low" }) {
  const color =
    label === "high" ? "var(--color-grass-bright)" : label === "medium" ? "var(--color-brass)" : "var(--color-blood)";
  return (
    <span className="font-mono inline-flex items-center gap-1.5 text-[0.6rem] uppercase tracking-wider text-(--color-chalk-faint)">
      <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: color }} />
      {label} confidence
    </span>
  );
}

export function CompareBar({
  label,
  a,
  b,
}: {
  label: string;
  a: number;
  b: number;
}) {
  const total = a + b;
  const aPct = total > 0 ? (a / total) * 100 : 50;
  const lead = Math.abs(a - b) < 1 ? "even" : a > b ? "a" : "b";
  return (
    <div>
      <div className="font-mono mb-1 flex items-center justify-between text-[0.65rem] uppercase tracking-wider">
        <span className={lead === "a" ? "text-(--color-brass)" : "text-(--color-chalk-faint)"}>{a.toFixed(0)}</span>
        <span className="text-(--color-chalk-dim)">{label}</span>
        <span className={lead === "b" ? "text-(--color-brass)" : "text-(--color-chalk-faint)"}>{b.toFixed(0)}</span>
      </div>
      <div className="flex h-1.5 overflow-hidden rounded-full bg-(--color-line)">
        <div className="bg-(--color-grass-bright)" style={{ width: `${aPct}%` }} />
        <div className="bg-(--color-brass)" style={{ width: `${100 - aPct}%` }} />
      </div>
    </div>
  );
}
