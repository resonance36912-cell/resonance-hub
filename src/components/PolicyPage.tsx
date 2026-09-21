import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

type PolicySection = {
  title: string;
  body: ReactNode;
};

export function PolicyPage({
  eyebrow,
  title,
  summary,
  sections,
}: {
  eyebrow: string;
  title: string;
  summary: string;
  sections: PolicySection[];
}) {
  return (
    <div className="min-h-screen bg-black text-white">
      <main className="max-w-3xl mx-auto px-6 py-20">
        <nav className="mb-12 text-[10px] font-mono uppercase tracking-widest text-white/50">
          <Link to="/" className="hover:text-white">← Back to Hub</Link>
        </nav>

        <header className="mb-14">
          <p className="text-[10px] font-mono uppercase tracking-widest text-white/50 mb-4">
            {eyebrow} · Effective 18 September 2026
          </p>
          <h1 className="text-4xl md:text-5xl font-semibold tracking-tight leading-tight">{title}</h1>
          <p className="mt-6 text-lg text-white/70 leading-relaxed">{summary}</p>
        </header>

        <div className="space-y-10">
          {sections.map((section) => (
            <section key={section.title} className="border-t border-white/10 pt-7">
              <h2 className="text-lg font-semibold tracking-tight mb-3">{section.title}</h2>
              <div className="text-sm md:text-base text-white/75 leading-relaxed space-y-3">
                {section.body}
              </div>
            </section>
          ))}
        </div>

        <footer className="mt-16 border-t border-white/10 pt-8 text-sm text-white/60">
          <p>
            Service operator: The Resonance. Questions or requests can be sent to{" "}
            <a className="underline hover:text-white" href="mailto:hello@reson8.life">hello@reson8.life</a>.
          </p>
          <p className="mt-3">
            These operational policies are intended to describe the service as implemented. Mandatory consumer,
            privacy, and other statutory rights remain unaffected.
          </p>
        </footer>
      </main>
    </div>
  );
}
