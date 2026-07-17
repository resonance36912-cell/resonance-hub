#!/usr/bin/env bun
/**
 * End-to-end smoke test: hits a production-like server (wrangler dev on
 * dist/server or a remote preview URL) and asserts that:
 *
 *   1. The homepage `/` renders the Roadmap section server-side and it
 *      uses the Phase 7 lifecycle vocabulary (Live / Rolling out / In
 *      development / Planned / Delayed / Paused) — never `Q1 2026`-style
 *      hard target dates.
 *   2. Each legal route (`/legal`, `/legal/privacy`, `/legal/terms`,
 *      `/legal/cookies`) responds 200 and ships a distinct `<title>` so
 *      search engines and social embeds treat them as separate documents.
 *
 * Runs against `BASE_URL` (default http://localhost:8080). CI serves the
 * built Worker via `bunx wrangler dev` before invoking this script — see
 * .github/workflows/verify-prebuild.yml.
 *
 * Exits non-zero on any failure so it can gate the pipeline.
 */

const BASE = process.env.BASE_URL ?? "http://localhost:8080";

const LIFECYCLE_LABELS = [
  "Live",
  "Rolling out",
  "In development",
  "Planned",
  "Delayed",
  "Paused",
];

const LEGAL_ROUTES = [
  "/legal",
  "/legal/privacy",
  "/legal/terms",
  "/legal/cookies",
];

type Failure = { name: string; detail: string };
const failures: Failure[] = [];
const passes: string[] = [];

function pass(name: string, detail = "") {
  passes.push(`${name}${detail ? ` — ${detail}` : ""}`);
  console.log(`✓ ${name}${detail ? ` — ${detail}` : ""}`);
}
function fail(name: string, detail: string) {
  failures.push({ name, detail });
  console.log(`✗ ${name} — ${detail}`);
}

async function get(path: string): Promise<{ status: number; body: string; finalUrl: string }> {
  const url = new URL(path, BASE).toString();
  const res = await fetch(url, { redirect: "follow" });
  const body = await res.text();
  return { status: res.status, body, finalUrl: res.url };
}

function extractTitle(html: string): string | null {
  const m = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  return m ? m[1].trim() : null;
}

function extractRoadmapSection(html: string): string | null {
  // Server-rendered HTML: locate the `<section id="roadmap"` block and
  // return everything up to the next top-level <section id="..."> boundary.
  const start = html.search(/<section\b[^>]*\bid=["']roadmap["']/i);
  if (start < 0) return null;
  const rest = html.slice(start);
  const next = rest.slice(1).search(/<section\b[^>]*\bid=["'][^"']+["']/i);
  return next < 0 ? rest : rest.slice(0, next + 1);
}

// --- 1. Homepage roadmap -----------------------------------------------------

try {
  const home = await get("/");
  if (home.status !== 200) {
    fail("Homepage 200", `status ${home.status}`);
  } else {
    pass("Homepage 200", `${home.finalUrl}`);
  }

  const roadmap = extractRoadmapSection(home.body);
  if (!roadmap) {
    fail("Roadmap section rendered server-side", 'no <section id="roadmap"> in SSR HTML');
  } else {
    pass("Roadmap section rendered server-side", `${roadmap.length} chars`);

    const foundLabels = LIFECYCLE_LABELS.filter((l) => roadmap.includes(l));
    if (foundLabels.length === 0) {
      fail(
        "Roadmap uses lifecycle labels",
        `none of ${LIFECYCLE_LABELS.join(", ")} present in roadmap SSR HTML`,
      );
    } else {
      pass("Roadmap uses lifecycle labels", foundLabels.join(", "));
    }

    const hardTargets = roadmap.match(/\bQ[1-4]\s*20\d{2}\b/g) ?? [];
    if (hardTargets.length > 0) {
      fail("Roadmap avoids Q-style hard targets", `found ${hardTargets.join(", ")}`);
    } else {
      pass("Roadmap avoids Q-style hard targets");
    }
  }
} catch (err) {
  fail("Homepage fetch", (err as Error).message);
}

// --- 2. Legal routes ---------------------------------------------------------

const legalTitles: Record<string, string> = {};

for (const path of LEGAL_ROUTES) {
  try {
    const res = await get(path);
    if (res.status !== 200) {
      fail(`Legal route 200 (${path})`, `status ${res.status}`);
      continue;
    }
    pass(`Legal route 200 (${path})`);

    const title = extractTitle(res.body);
    if (!title) {
      fail(`Legal route has <title> (${path})`, "no <title> in SSR HTML");
      continue;
    }
    legalTitles[path] = title;
    pass(`Legal route has <title> (${path})`, title);
  } catch (err) {
    fail(`Legal route fetch (${path})`, (err as Error).message);
  }
}

const titleValues = Object.values(legalTitles);
if (titleValues.length >= 2) {
  const unique = new Set(titleValues);
  if (unique.size !== titleValues.length) {
    fail(
      "Legal routes have distinct <title>s",
      `duplicates in ${JSON.stringify(legalTitles)}`,
    );
  } else {
    pass("Legal routes have distinct <title>s", `${unique.size} unique`);
  }
}

// --- summary -----------------------------------------------------------------

console.log(`\n${passes.length}/${passes.length + failures.length} passed (base: ${BASE})`);
if (failures.length > 0) {
  console.error(`\n${failures.length} failure(s):`);
  for (const f of failures) console.error(`  - ${f.name}: ${f.detail}`);
  process.exit(1);
}
