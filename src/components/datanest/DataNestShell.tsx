import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";

export function DataNestShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border/70 bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-5 py-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
              Resonance AppDev
            </p>
            <h1 className="mt-1 text-xl font-semibold">DataNest · Hosting + Collaboration</h1>
          </div>
          <nav className="flex flex-wrap items-center gap-2 text-sm" aria-label="DataNest navigation">
            <Link to="/datanest" className="rounded-lg border px-3 py-2 hover:bg-accent">
              DataNest Home
            </Link>
            <Link to="/nova" className="rounded-lg border px-3 py-2 hover:bg-accent">
              Nova / App Builder
            </Link>
            <Link to="/governance" className="rounded-lg border px-3 py-2 hover:bg-accent">
              Governance
            </Link>
            <Link to="/" className="rounded-lg border px-3 py-2 hover:bg-accent">
              RONSAS Hub
            </Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-5 py-6">{children}</main>
      <footer className="mx-auto max-w-7xl px-5 pb-8 text-xs text-muted-foreground">
        Connect through an authorized provider; DataNest stores only connection references and
        display metadata.
      </footer>
    </div>
  );
}
