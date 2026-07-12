import { createFileRoute, Link } from "@tanstack/react-router";
import {
  RCGF_VERSION,
  RCGF_EFFECTIVE_DATE,
  RCGF_LICENSE,
  RCGF_REPO_URL,
  RCGF_CANONICAL_URL,
  RCGF_EXAMPLES_URL,
} from "@/lib/rcgf";

export const Route = createFileRoute("/governance")({
  head: () => ({
    meta: [
      { title: "Resonance Constitutional Governance Framework v1.0 — The Resonance" },
      {
        name: "description",
        content:
          "The RCGF is the universal constitutional standard for human–AI collaboration across the Resonance ecosystem: truth, transparency, sovereignty, accountability and continuous improvement.",
      },
      { property: "og:title", content: "Resonance Constitutional Governance Framework v1.0" },
      {
        property: "og:description",
        content:
          "The universal constitution for human–AI collaboration across the Resonance ecosystem. Human sovereignty remains the final authority.",
      },
    ],
  }),
  component: GovernancePage,
});

const ARTICLES: Array<{ no: string; title: string; body: string }> = [
  { no: "I", title: "Human Sovereignty", body: "Humans retain ultimate authority. AI informs and assists; humans decide." },
  { no: "II", title: "Truth", body: "Differentiate verified facts, evidence, assumptions, inference, opinion and speculation. Unknowns remain identified as unknowns." },
  { no: "III", title: "Transparency", body: "Material decisions should be explainable, including evidence, confidence, assumptions, limitations, alternatives and risks where practical." },
  { no: "IV", title: "Resonance", body: "Seek harmony between logic, creativity, ethics, wellbeing, sustainability and long-term value." },
  { no: "V", title: "Continuous Improvement", body: "Observe → Measure → Validate → Test → Recommend → Review → Approve → Version → Deploy → Audit → Improve. Material governance changes require approval." },
  { no: "VI", title: "Accountability", body: "Maintain ownership, versioning, timestamps, rationale and audit trails for significant actions." },
  { no: "VII", title: "Evidence Hierarchy", body: "Observable reality → Verified evidence → Approved governance → Testing → Reliable external sources → Logical inference → Speculation." },
  { no: "VIII", title: "Security & Privacy", body: "Protect privacy, intellectual property, security, data integrity and lawful, ethical use." },
  { no: "IX", title: "Quality", body: "Strive for reliability, performance, security, maintainability, scalability, accessibility, cost-effectiveness and explainability." },
  { no: "X", title: "Collaboration", body: "Humans, AI, APIs and automations operate as one governed ecosystem." },
  { no: "XI", title: "Explainability", body: "Communicate reasoning, alternatives, trade-offs, confidence and risks where practical." },
  { no: "XII", title: "Legacy", body: "Strengthen the ecosystem for future generations while remaining adaptable." },
];

const VALUES = [
  "Truth", "Transparency", "Sovereignty", "Resonance",
  "Accountability", "Stewardship", "Continuous Learning",
  "Innovation", "Collaboration", "Integrity",
];

function GovernancePage() {
  return (
    <div className="min-h-screen bg-black text-white">
      <main className="max-w-3xl mx-auto px-6 py-20">
        <nav className="mb-12 text-[10px] font-mono uppercase tracking-widest text-white/50">
          <Link to="/" className="hover:text-white">← Back to Hub</Link>
        </nav>

        <header className="mb-16">
          <p className="text-[10px] font-mono uppercase tracking-widest text-white/50 mb-4">
            Constitutional Standard · v{RCGF_VERSION} · Effective {RCGF_EFFECTIVE_DATE}
          </p>
          <h1 className="text-4xl md:text-5xl font-semibold tracking-tight leading-tight">
            Resonance Constitutional Governance Framework
          </h1>
          <p className="mt-6 text-lg text-white/70 leading-relaxed">
            The universal constitution for human–AI collaboration across the
            Resonance ecosystem. Human sovereignty remains the final authority.
          </p>
        </header>

        <section className="mb-16">
          <h2 className="text-xs font-mono uppercase tracking-widest text-white/50 mb-4">Preamble</h2>
          <p className="text-white/80 leading-relaxed">
            The RCGF establishes a universal governance standard for the Resonance ecosystem.
            It guides every person, AI system, automation, workflow, API and application
            according to shared principles of truth, transparency, sovereignty,
            accountability, ethical stewardship and continuous improvement.
          </p>
        </section>

        <section className="mb-16">
          <h2 className="text-xs font-mono uppercase tracking-widest text-white/50 mb-4">Core Values</h2>
          <ul className="flex flex-wrap gap-2">
            {VALUES.map((v) => (
              <li key={v} className="px-3 py-1 rounded-full border border-white/15 text-sm text-white/80">
                {v}
              </li>
            ))}
          </ul>
        </section>

        <section className="mb-16">
          <h2 className="text-xs font-mono uppercase tracking-widest text-white/50 mb-6">Articles</h2>
          <ol className="space-y-8">
            {ARTICLES.map((a) => (
              <li key={a.no}>
                <h3 className="text-lg font-semibold tracking-tight">
                  Article {a.no} — {a.title}
                </h3>
                <p className="mt-2 text-white/75 leading-relaxed">{a.body}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="mb-16">
          <h2 className="text-xs font-mono uppercase tracking-widest text-white/50 mb-4">Governance Layers</h2>
          <p className="font-mono text-sm text-white/70 leading-loose">
            Constitution → Standards → Protocols → Procedures → Implementation → Audit → Continuous Improvement
          </p>
        </section>

        <section className="mb-16">
          <h2 className="text-xs font-mono uppercase tracking-widest text-white/50 mb-4">Amendment Process</h2>
          <p className="font-mono text-sm text-white/70 leading-loose">
            Proposal → Evidence → Impact Assessment → Review → Approval → Version Increment → Change Log → Ecosystem Adoption
          </p>
        </section>

        <section className="mb-16 border-t border-white/10 pt-8">
          <h2 className="text-xs font-mono uppercase tracking-widest text-white/50 mb-4">Canonical Source</h2>
          <p className="text-white/75 leading-relaxed">
            The authoritative RCGF specification, standards, prompts and machine-readable
            schemas are published under {RCGF_LICENSE} at{" "}
            <a href={RCGF_REPO_URL} target="_blank" rel="noopener noreferrer" className="underline hover:text-white">
              resonance36912-cell/RCGF
            </a>
            . Reference implementations live at{" "}
            <a href={RCGF_EXAMPLES_URL} target="_blank" rel="noopener noreferrer" className="underline hover:text-white">
              RCGF-Examples
            </a>
            .
          </p>
          <ul className="mt-4 space-y-1 text-sm text-white/70">
            <li>
              →{" "}
              <a href={RCGF_CANONICAL_URL} target="_blank" rel="noopener noreferrer" className="underline hover:text-white">
                Constitution v{RCGF_VERSION} (canonical markdown)
              </a>
            </li>
            <li>
              →{" "}
              <a
                href={`${RCGF_REPO_URL}/blob/main/prompts/Universal_System_Prompt.md`}
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-white"
              >
                Universal AI System Prompt
              </a>
            </li>
            <li>
              →{" "}
              <a
                href={`${RCGF_REPO_URL}/blob/main/schemas/rcgf.json`}
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-white"
              >
                Machine-readable schema (JSON)
              </a>
            </li>
          </ul>
        </section>

        <section className="mb-16 border-t border-white/10 pt-8">
          <p className="text-white/70 leading-relaxed italic">
            The RCGF serves as the governing constitutional standard for the
            Resonance ecosystem. Material changes must be transparent,
            evidence-based, version-controlled and explicitly approved before
            becoming canonical. Human oversight remains the final authority.
          </p>
          <p className="mt-8 text-center text-xs font-mono uppercase tracking-widest text-white/50">
            Truth · Transparency · Sovereignty · Resonance · Continuous Evolution
          </p>
        </section>
      </main>
    </div>
  );
}
