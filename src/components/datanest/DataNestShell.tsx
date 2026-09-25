import type { ReactNode } from "react";

const nav = [
  ["DataNest Home", "/datanest"],
  ["Nova / App Builder", "/nova"],
  ["Governance", "/governance/workspace"],
  ["RONSAS Hub", "/"],
] as const;

export function DataNestShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border bg-card/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-5 py-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
              Resonance AppDev · DataNest
            </p>
            <h1 className="mt-1 text-xl font-semibold">Hosting + collaboration</h1>
          </div>
          <nav className="flex flex-wrap gap-2 text-sm" aria-label="DataNest navigation">
            {nav.map(([label, href]) => (
              <a key={href} href={href} className="rounded-lg border border-border px-3 py-2 hover:bg-accent">
                {label}
              </a>
            ))}
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-5 py-6">{children}</main>
    </div>
  );
}
