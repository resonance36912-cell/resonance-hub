import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";

type UpdateItem = {
  app: string;
  status: string;
  change: string;
  date: string;
  href?: string;
  cta?: string;
};

export const Route = createFileRoute("/changelog")({
  head: () => ({
    meta: [
      { title: "Changelog | The Resonance Hub" },
      { name: "description", content: "Public product and ecosystem changes across Reson8.life and the Resonance application suite." },
    ],
  }),
  component: ChangelogPage,
});

function ChangelogPage() {
  const [items, setItems] = useState<UpdateItem[]>([]);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch("/content/updates.json", { cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error(`updates fetch failed (${response.status})`);
        return response.json();
      })
      .then((payload) => {
        if (alive && Array.isArray(payload)) setItems(payload);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="min-h-screen bg-black text-white">
      <main className="max-w-4xl mx-auto px-6 py-20">
        <nav className="mb-12 text-[10px] font-mono uppercase tracking-widest text-white/50">
          <Link to="/" className="hover:text-white">← Back to Hub</Link>
        </nav>

        <header className="mb-12">
          <p className="text-[10px] font-mono uppercase tracking-widest text-white/50 mb-4">
            Public release record
          </p>
          <h1 className="text-4xl md:text-5xl font-semibold tracking-tight">Changelog</h1>
          <p className="mt-5 text-white/70 leading-relaxed max-w-2xl">
            Product availability, pricing model changes, migrations, pilots, and governance updates across the Resonance ecosystem.
          </p>
        </header>

        {failed ? (
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 text-white/70">
            The update feed could not be loaded. The same maintained update feed is available on the{" "}
            <Link to="/" hash="updates" className="underline hover:text-white">Hub home page</Link>.
          </div>
        ) : items.length === 0 ? (
          <p className="text-white/60">Loading updates…</p>
        ) : (
          <div className="space-y-4">
            {items.map((item) => (
              <article key={`${item.app}-${item.date}-${item.change}`} className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
                <div className="flex flex-wrap items-center gap-3 mb-3">
                  <span className="text-[10px] font-mono uppercase tracking-widest text-white/50">{item.date}</span>
                  <span className="rounded-full border border-white/15 px-2.5 py-1 text-[10px] font-mono uppercase tracking-wider text-white/70">{item.status}</span>
                </div>
                <h2 className="text-xl font-semibold tracking-tight">{item.app}</h2>
                <p className="mt-2 text-sm text-white/70 leading-relaxed">{item.change}</p>
                {item.href && item.cta ? (
                  item.href.startsWith("http") ? (
                    <a href={item.href} target="_blank" rel="noreferrer" className="inline-block mt-4 text-xs font-bold uppercase tracking-widest underline underline-offset-4">
                      {item.cta} →
                    </a>
                  ) : (
                    <a href={item.href} className="inline-block mt-4 text-xs font-bold uppercase tracking-widest underline underline-offset-4">
                      {item.cta} →
                    </a>
                  )
                ) : null}
              </article>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
