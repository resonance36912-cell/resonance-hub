import { createFileRoute } from "@tanstack/react-router";
import resonantMotif from "@/assets/resonant-motif.jpg";

export const Route = createFileRoute("/")({
  component: Index,
});

type App = {
  name: string;
  href?: string;
  tagline: string;
  meta: string;
  cta: string;
  accent: "emerald" | "amber" | "violet" | "ruby";
  status: "live" | "soon";
};

const apps: App[] = [
  {
    name: "Resonance Online",
    href: "https://www.resonanceonline.life",
    tagline: "Collective flow states for remote teams. Sync your work rhythms.",
    meta: "Frequency 432Hz",
    cta: "Enter the flow",
    accent: "emerald",
    status: "live",
  },
  {
    name: "Creative Studio",
    href: "https://www.creativestudio.life",
    tagline: "The workspace for unbounded ideation and visual harmony.",
    meta: "Synthesis v2.4",
    cta: "Launch Studio",
    accent: "amber",
    status: "live",
  },
  {
    name: "Sync Vision",
    href: "https://www.syncvision.life",
    tagline: "Visualize time as a spectrum. Temporal alignment for visionaries.",
    meta: "Temporal Layer",
    cta: "Adjust Vision",
    accent: "violet",
    status: "live",
  },
  {
    name: "YouTube Optimizer",
    tagline: "Resonating with your audience. Deep analytics meets intuitive design.",
    meta: "Arriving Soon",
    cta: "Coming Q3 2026",
    accent: "ruby",
    status: "soon",
  },
];

const accentMap: Record<App["accent"], { glow: string; border: string; text: string; dot: string }> = {
  emerald: {
    glow: "bg-[hsl(150_80%_50%/0.10)] group-hover:bg-[hsl(150_80%_50%/0.20)]",
    border: "hover:border-[hsl(150_80%_50%/0.35)]",
    text: "text-[hsl(150_80%_55%)]",
    dot: "bg-[hsl(150_80%_50%)] shadow-[0_0_20px_hsl(150_80%_50%/0.6)]",
  },
  amber: {
    glow: "bg-[hsl(35_90%_55%/0.10)] group-hover:bg-[hsl(35_90%_55%/0.20)]",
    border: "hover:border-[hsl(35_90%_55%/0.35)]",
    text: "text-[hsl(35_90%_60%)]",
    dot: "bg-[hsl(35_90%_55%)] shadow-[0_0_20px_hsl(35_90%_55%/0.6)]",
  },
  violet: {
    glow: "bg-[hsl(260_80%_70%/0.10)] group-hover:bg-[hsl(260_80%_70%/0.20)]",
    border: "hover:border-[hsl(260_80%_70%/0.35)]",
    text: "text-[hsl(260_80%_75%)]",
    dot: "bg-[hsl(260_80%_70%)] shadow-[0_0_20px_hsl(260_80%_70%/0.6)]",
  },
  ruby: {
    glow: "",
    border: "",
    text: "text-[hsl(0_80%_65%)]",
    dot: "",
  },
};

function Index() {
  return (
    <div className="min-h-screen bg-background text-foreground selection:bg-white/20">
      <nav className="fixed top-0 w-full z-50 px-6 py-8 flex justify-between items-center mix-blend-difference">
        <div className="text-xl font-extrabold tracking-tighter uppercase">Resonance</div>
        <div className="hidden md:flex gap-8 text-[11px] font-bold tracking-[0.2em] uppercase">
          <a href="#ecosystem" className="hover:text-[hsl(260_80%_75%)] transition-colors">
            Ecosystem
          </a>
          <a href="#philosophy" className="hover:text-[hsl(260_80%_75%)] transition-colors">
            Laboratory
          </a>
          <a href="#join" className="opacity-50 hover:opacity-100 transition-opacity">
            Manifesto
          </a>
        </div>
      </nav>

      <main className="pt-32 pb-24 px-6 max-w-7xl mx-auto">
        <section className="mb-32 animate-reveal">
          <div className="max-w-3xl">
            <h1 className="text-5xl md:text-8xl font-extrabold tracking-tight leading-[0.9] text-balance mb-8">
              Tools for the{" "}
              <span className="font-serif italic font-normal text-muted">aligned</span> mind.
            </h1>
            <p className="text-xl text-muted leading-relaxed text-pretty max-w-[45ch]">
              A family of applications designed to harmonize your digital existence. We build
              instruments for focus, creativity, and conscious connection.
            </p>
          </div>
        </section>

        <section id="ecosystem" className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {apps.map((app, i) => {
            const a = accentMap[app.accent];
            const isSoon = app.status === "soon";
            return (
              <article
                key={app.name}
                className={`group relative overflow-hidden rounded-2xl bg-zinc-900/40 border border-border ${
                  isSoon ? "border-dashed" : a.border
                } aspect-[4/5] md:aspect-square flex flex-col p-8 transition-all duration-500 animate-reveal`}
                style={{ animationDelay: `${200 + i * 100}ms` }}
              >
                {!isSoon && (
                  <div
                    className={`absolute -top-24 -right-24 size-64 blur-[100px] transition-all duration-700 ${a.glow}`}
                  />
                )}
                <div className={`mt-auto ${isSoon ? "opacity-60" : ""}`}>
                  <div
                    className={`font-mono text-[10px] uppercase tracking-widest mb-4 ${a.text} ${
                      isSoon ? "italic" : ""
                    }`}
                  >
                    {app.meta}
                  </div>
                  <h3 className="text-4xl font-bold tracking-tight mb-2">{app.name}</h3>
                  <p className="text-muted mb-8 max-w-[30ch]">{app.tagline}</p>
                  {isSoon ? (
                    <div className="text-xs font-bold uppercase tracking-widest text-white/40">
                      {app.cta}
                    </div>
                  ) : (
                    <a
                      href={app.href}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-2 px-5 py-2 rounded-full border border-white/10 hover:bg-white hover:text-black transition-all text-sm font-bold"
                    >
                      {app.cta}
                      <span aria-hidden>→</span>
                    </a>
                  )}
                </div>
                {!isSoon && (
                  <div
                    className={`absolute top-12 right-12 size-3 rounded-full animate-pulse-slow ${a.dot}`}
                  />
                )}
              </article>
            );
          })}
        </section>

        <section
          id="philosophy"
          className="mt-48 grid md:grid-cols-2 gap-24 items-center animate-reveal"
        >
          <div>
            <img
              src={resonantMotif}
              alt="Tuning fork radiating concentric frequency waves"
              loading="lazy"
              width={1024}
              height={1024}
              className="w-full aspect-square rounded-full object-cover border border-white/5 opacity-80"
            />
          </div>
          <div>
            <h2 className="text-3xl font-bold mb-6 tracking-tight">The Resonance Philosophy</h2>
            <div className="space-y-6 text-muted leading-relaxed">
              <p>
                We believe technology shouldn't fragment our attention, but align it. Every app in
                the Resonance ecosystem is built on the principle of{" "}
                <span className="text-foreground">Harmonic UX</span>—where features respond to human
                intuition like a tuned instrument.
              </p>
              <p className="font-serif italic text-foreground/80">
                "When the tool disappears, only the intention remains."
              </p>
              <a
                href="#join"
                className="inline-block text-foreground underline underline-offset-8 font-bold text-sm tracking-wide"
              >
                Read the Manifesto
              </a>
            </div>
          </div>
        </section>

        <section
          id="join"
          className="mt-48 py-24 border-y border-border flex flex-col items-center text-center animate-reveal"
        >
          <h2 className="text-4xl font-bold tracking-tight mb-4">Join the frequency.</h2>
          <p className="text-muted mb-12 max-w-[40ch]">
            Get notified when we release new instruments for your creative ecosystem.
          </p>
          <form
            className="w-full max-w-md flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
            }}
          >
            <input
              type="email"
              required
              placeholder="email@domain.com"
              className="flex-1 bg-white/5 border border-white/10 rounded-full px-6 py-3 text-sm focus:outline-none focus:border-[hsl(260_80%_70%)] transition-colors"
            />
            <button
              type="submit"
              className="px-8 py-3 bg-foreground text-background rounded-full font-bold text-sm hover:bg-[hsl(260_80%_70%)] hover:text-background transition-colors"
            >
              Subscribe
            </button>
          </form>
        </section>
      </main>

      <footer className="py-12 px-6 flex flex-col md:flex-row justify-between items-center gap-8 max-w-7xl mx-auto border-t border-white/5 opacity-60">
        <div className="text-[10px] font-mono uppercase tracking-widest">
          © {new Date().getFullYear()} Resonance Apps Laboratory
        </div>
        <div className="flex gap-12 text-[10px] font-mono uppercase tracking-widest">
          <a href="#" className="hover:text-white transition-colors">
            Twitter
          </a>
          <a href="#" className="hover:text-white transition-colors">
            GitHub
          </a>
          <a href="#" className="hover:text-white transition-colors">
            Mirror
          </a>
        </div>
      </footer>
    </div>
  );
}
