import type { Metadata } from "next";
import { Fraunces, IBM_Plex_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-fraunces",
  axes: ["opsz", "SOFT", "WONK"],
});

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-plex-mono",
});

export const metadata: Metadata = {
  title: "Immortal XI — the all-era European draft",
  description:
    "Draft a starting XI from real European Cup and Champions League squads, 1956 to today, then survive a full continental campaign. Unofficial fan-made game built on public historical records.",
};

function Crown() {
  return (
    <svg width="20" height="14" viewBox="0 0 20 14" aria-hidden className="inline-block">
      <path
        d="M1 12 L2.5 3.5 L6.5 8 L10 1 L13.5 8 L17.5 3.5 L19 12 Z"
        fill="none"
        stroke="var(--color-brass)"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${fraunces.variable} ${plexMono.variable} antialiased`}>
        <svg className="pitch-lines" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice" aria-hidden>
          <circle cx="50" cy="50" r="18" fill="none" stroke="#ece3cd" strokeWidth="0.2" />
          <line x1="0" y1="50" x2="100" y2="50" stroke="#ece3cd" strokeWidth="0.2" />
          <rect x="30" y="-10" width="40" height="22" fill="none" stroke="#ece3cd" strokeWidth="0.2" />
          <rect x="30" y="88" width="40" height="22" fill="none" stroke="#ece3cd" strokeWidth="0.2" />
        </svg>
        <div className="relative z-10 mx-auto flex min-h-screen w-full max-w-6xl flex-col px-4 sm:px-6">
          <header className="flex items-center justify-between py-5">
            <Link href="/" className="group flex items-baseline gap-2">
              <Crown />
              <span className="text-xl font-semibold tracking-tight">
                Immortal <span className="text-(--color-brass)">XI</span>
              </span>
              <span className="font-mono hidden text-[0.6rem] uppercase tracking-[0.3em] text-(--color-chalk-faint) sm:inline">
                est. 1955
              </span>
            </Link>
            <nav className="font-mono flex items-center gap-1 text-[0.7rem] uppercase tracking-[0.18em]">
              {[
                ["/draft", "Play"],
                ["/h2h", "Head-to-Head"],
                ["/data", "Data Room"],
                ["/about", "About"],
              ].map(([href, label]) => (
                <Link
                  key={href}
                  href={href}
                  className="rounded px-2.5 py-1.5 text-(--color-chalk-dim) transition hover:bg-(--color-ink-3) hover:text-(--color-chalk) sm:px-3"
                >
                  {label}
                </Link>
              ))}
            </nav>
          </header>
          <main className="flex-1 pb-16">{children}</main>
          <footer className="ticket-edge font-mono flex flex-wrap items-center justify-between gap-2 py-6 text-[0.65rem] uppercase tracking-[0.2em] text-(--color-chalk-faint)">
            <span>Unofficial fan project · no UEFA or club affiliation</span>
            <span>
              built from public historical records ·{" "}
              <Link href="/about" className="underline decoration-(--color-line) underline-offset-4 hover:text-(--color-chalk)">
                provenance
              </Link>
            </span>
          </footer>
        </div>
      </body>
    </html>
  );
}
