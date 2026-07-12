import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo } from "react";
import changelogSource from "../../CHANGELOG.md?raw";
import { ROUTES } from "@/lib/routes";

export const Route = createFileRoute("/changelog")({
  head: () => ({
    meta: [
      { title: "Changelog — Resonance Hub" },
      {
        name: "description",
        content:
          "Release notes and notable changes for resonance-hub — billing, entitlements, governance, and ecosystem updates.",
      },
      { property: "og:title", content: "Changelog — Resonance Hub" },
      {
        property: "og:description",
        content:
          "Every notable change to the Resonance Hub, in Keep a Changelog format.",
      },
      { property: "og:type", content: "website" },
      { property: "og:site_name", content: "Reson8.life" },
      { name: "twitter:card", content: "summary" },
    ],
    links: [{ rel: "canonical", href: "https://reson8.life/changelog" }],
  }),
  component: ChangelogPage,
});

type Section = { heading: string; items: string[]; note?: string };
type Version = {
  version: string;
  date: string | null;
  intro: string[];
  sections: Section[];
};

function parseChangelog(md: string): { preamble: string[]; versions: Version[] } {
  const lines = md.split(/\r?\n/);
  const preamble: string[] = [];
  const versions: Version[] = [];
  let cur: Version | null = null;
  let curSec: Section | null = null;
  let inHtmlComment = false;

  const commit = () => {
    if (curSec && cur) cur.sections.push(curSec);
    curSec = null;
  };

  for (const raw of lines) {
    const line = raw;

    if (inHtmlComment) {
      if (line.includes("-->")) inHtmlComment = false;
      continue;
    }
    if (line.trim().startsWith("<!--")) {
      if (!line.includes("-->")) inHtmlComment = true;
      continue;
    }

    const h2 = line.match(/^##\s+(.+?)\s*$/);
    if (h2) {
      commit();
      if (cur) versions.push(cur);
      const raw2 = h2[1];
      // e.g. "[Unreleased]" or "[0.1.0] — 2026-07-12"
      const m = raw2.match(/\[([^\]]+)\](?:\s*[—-]\s*(.+))?/);
      cur = {
        version: m ? m[1] : raw2,
        date: m && m[2] ? m[2].trim() : null,
        intro: [],
        sections: [],
      };
      continue;
    }

    const h3 = line.match(/^###\s+(.+?)\s*$/);
    if (h3 && cur) {
      commit();
      curSec = { heading: h3[1], items: [] };
      continue;
    }

    const bullet = line.match(/^\s*[-*]\s+(.+?)\s*$/);
    if (bullet && curSec) {
      curSec.items.push(bullet[1]);
      continue;
    }

    // Plain paragraph text
    if (!cur) {
      if (line.trim()) preamble.push(line);
      continue;
    }
    if (curSec) {
      const t = line.trim();
      if (t && !t.startsWith("_")) curSec.note = (curSec.note ?? "") + " " + t;
      if (t.startsWith("_") && t.endsWith("_")) {
        // "_Nothing yet._" style placeholder — mark as empty
        curSec.note = t.replace(/^_|_$/g, "");
      }
    } else {
      if (line.trim()) cur.intro.push(line);
    }
  }
  commit();
  if (cur) versions.push(cur);

  return { preamble, versions };
}

// Minimal inline markdown: **bold**, `code`, [text](url), and #123 → GitHub issue links.
const REPO = "https://github.com/resonance36912-cell/resonance-hub";
function renderInline(text: string): React.ReactNode[] {
  // Escape by tokenizing.
  const nodes: React.ReactNode[] = [];
  const regex =
    /(\[([^\]]+)\]\(([^)]+)\))|(`([^`]+)`)|(\*\*([^*]+)\*\*)|(#(\d+))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = regex.exec(text))) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    if (m[1]) {
      nodes.push(
        <a
          key={key++}
          href={m[3]}
          className="text-white underline underline-offset-2 hover:text-white/80"
          target={m[3].startsWith("http") ? "_blank" : undefined}
          rel={m[3].startsWith("http") ? "noopener noreferrer" : undefined}
        >
          {m[2]}
        </a>,
      );
    } else if (m[4]) {
      nodes.push(
        <code
          key={key++}
          className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-[0.85em] text-white/90"
        >
          {m[5]}
        </code>,
      );
    } else if (m[6]) {
      nodes.push(
        <strong key={key++} className="text-white">
          {m[7]}
        </strong>,
      );
    } else if (m[8]) {
      nodes.push(
        <a
          key={key++}
          href={`${REPO}/issues/${m[9]}`}
          className="text-white underline underline-offset-2 hover:text-white/80"
          target="_blank"
          rel="noopener noreferrer"
        >
          {m[8]}
        </a>,
      );
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

const SECTION_TONE: Record<string, string> = {
  Added: "text-emerald-300 border-emerald-400/40 bg-emerald-400/10",
  Changed: "text-sky-300 border-sky-400/40 bg-sky-400/10",
  Deprecated: "text-amber-300 border-amber-400/40 bg-amber-400/10",
  Removed: "text-rose-300 border-rose-400/40 bg-rose-400/10",
  Fixed: "text-violet-300 border-violet-400/40 bg-violet-400/10",
  Security: "text-red-300 border-red-400/40 bg-red-400/10",
};

function ChangelogPage() {
  const { versions } = useMemo(() => parseChangelog(changelogSource), []);

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white">
      <header className="border-b border-white/5">
        <div className="mx-auto max-w-4xl px-6 py-16">
          <div className="mb-6 text-[10px] font-mono uppercase tracking-widest text-white/50">
            <Link to={ROUTES.home} className="hover:text-white">
              ← Back to Hub
            </Link>
          </div>
          <h1 className="text-4xl md:text-5xl font-semibold tracking-tight">
            Changelog
          </h1>
          <p className="mt-4 max-w-2xl text-white/70">
            Every notable change to the Resonance Hub — billing, entitlements,
            governance, and ecosystem updates. Format:{" "}
            <a
              href="https://keepachangelog.com/en/1.1.0/"
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-2 hover:text-white"
            >
              Keep a Changelog
            </a>
            . Governed by{" "}
            <Link to={ROUTES.governance} className="underline underline-offset-2 hover:text-white">
              RCGF v1.0
            </Link>
            .
          </p>
          <div className="mt-6 flex flex-wrap gap-3 text-[10px] font-mono uppercase tracking-widest">
            <a
              href={`${REPO}/blob/main/CHANGELOG.md`}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded border border-white/15 px-3 py-1.5 text-white/80 hover:border-white/40 hover:text-white"
            >
              View on GitHub
            </a>
            <a
              href={`${REPO}/releases`}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded border border-white/15 px-3 py-1.5 text-white/80 hover:border-white/40 hover:text-white"
            >
              Releases
            </a>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-6 py-12 space-y-12">
        {versions.map((v) => {
          const isUnreleased = /unreleased/i.test(v.version);
          return (
            <section
              key={v.version}
              id={v.version.toLowerCase()}
              className="scroll-mt-24"
            >
              <div className="flex flex-wrap items-baseline gap-3 border-b border-white/10 pb-3">
                <h2 className="text-2xl font-semibold tracking-tight">
                  {isUnreleased ? "Unreleased" : `v${v.version}`}
                </h2>
                {v.date && (
                  <span className="text-[10px] font-mono uppercase tracking-widest text-white/50">
                    {v.date}
                  </span>
                )}
                {isUnreleased && (
                  <span className="rounded border border-amber-400/40 bg-amber-400/10 px-2 py-0.5 text-[10px] font-mono uppercase tracking-widest text-amber-300">
                    In progress
                  </span>
                )}
              </div>

              {v.intro.length > 0 && (
                <p className="mt-4 text-white/70">
                  {renderInline(v.intro.join(" "))}
                </p>
              )}

              <div className="mt-6 space-y-6">
                {v.sections.map((s) => {
                  const tone =
                    SECTION_TONE[s.heading] ??
                    "text-white/70 border-white/20 bg-white/5";
                  const empty = s.items.length === 0;
                  return (
                    <div key={s.heading}>
                      <div className="mb-3 flex items-center gap-3">
                        <span
                          className={`rounded border px-2 py-0.5 text-[10px] font-mono uppercase tracking-widest ${tone}`}
                        >
                          {s.heading}
                        </span>
                        {empty && (
                          <span className="text-xs text-white/40">
                            {s.note?.trim() || "Nothing yet."}
                          </span>
                        )}
                      </div>
                      {!empty && (
                        <ul className="space-y-2 pl-1">
                          {s.items.map((it, i) => (
                            <li
                              key={i}
                              className="flex gap-3 text-white/85 leading-relaxed"
                            >
                              <span
                                className="mt-2 h-1 w-1 flex-shrink-0 rounded-full bg-white/40"
                                aria-hidden
                              />
                              <span>{renderInline(it)}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}
      </main>

      <footer className="border-t border-white/5">
        <div className="mx-auto max-w-4xl px-6 py-10 text-[10px] font-mono uppercase tracking-widest text-white/50 flex flex-wrap gap-x-6 gap-y-2 justify-between">
          <span>© {new Date().getFullYear()} The Resonance</span>
          <div className="flex gap-6">
            <Link to={ROUTES.governance} className="hover:text-white">
              Governance
            </Link>
            <Link to={ROUTES.pricing} className="hover:text-white">
              Pricing
            </Link>
            <a
              href={`${REPO}/blob/main/CHANGELOG.md`}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-white"
            >
              Source
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
