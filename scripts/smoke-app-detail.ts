#!/usr/bin/env bun
/**
 * End-to-end smoke test: hits a production-like server (wrangler dev on
 * dist/server or a remote preview URL) and asserts that every
 * `/apps/$appKey` detail page renders correctly server-side:
 *
 *   1. Route responds 200.
 *   2. SSR HTML ships an app-specific `<title>` and meta description
 *      derived from APP_REGISTRY (SEO + social embeds).
 *   3. The three capability highlight cards from
 *      `src/routes/apps.$appKey.tsx` render server-side — proves the
 *      component mounted and the CAPABILITIES map is wired to the loader.
 *   4. The external "Open <app>" link points at the canonical `entry.url`
 *      with `target="_blank"` and `rel="noopener noreferrer"` — proves
 *      the outbound app link isn't silently broken after a registry edit.
 *   5. Invalid keys respond 404 (or the SSR notFoundComponent marker).
 *
 * Runs against `BASE_URL` (default http://localhost:8080). CI serves the
 * built Worker via `bunx wrangler dev` before invoking this script — see
 * .github/workflows/verify-prebuild.yml.
 *
 * Exits non-zero on any failure so it can gate the pipeline.
 */

import { APP_REGISTRY, type ResonanceAppKey } from "../src/lib/app-registry";
import { appDetailDescription } from "../src/lib/app-status-meta";

const BASE = process.env.BASE_URL ?? "http://localhost:8080";

// Mirrors the CAPABILITIES map in src/routes/apps.$appKey.tsx. Kept in
// sync intentionally — a rename in either place should fail this smoke
// test so we notice the drift.
const CAPABILITY_TITLES: Record<ResonanceAppKey, string[]> = {
  epublisher: ["Audiovisual publishing", "Chapter-aware workflow", "Distribution-ready exports"],
  creative_studio: ["Poster + ad generation", "Brand-consistent prompts", "Batch variations"],
  sync_vision: ["Music video planning", "Cinematic references", "Production handoff"],
  youtube_optimizer: ["Channel audit", "Optimisation playbooks", "Growth tracking"],
  all_access: ["Every paid app, one pass", "One statement line", "First access to new apps"],
};

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

function extractMetaDescription(html: string): string | null {
  const m = html.match(
    /<meta\b[^>]*\bname=["']description["'][^>]*\bcontent=["']([^"']*)["']/i,
  );
  return m ? m[1].trim() : null;
}

// --- 1. Per-app detail pages -------------------------------------------------

const titleSeen: string[] = [];

for (const key of Object.keys(APP_REGISTRY) as ResonanceAppKey[]) {
  const entry = APP_REGISTRY[key];
  const path = `/apps/${key}`;

  let res: Awaited<ReturnType<typeof get>>;
  try {
    res = await get(path);
  } catch (err) {
    fail(`GET ${path}`, (err as Error).message);
    continue;
  }

  if (res.status !== 200) {
    fail(`GET ${path} 200`, `status ${res.status}`);
    continue;
  }
  pass(`GET ${path} 200`);

  // Title matches the head() contract in src/routes/apps.$appKey.tsx.
  const title = extractTitle(res.body);
  const expectedTitle = `${entry.label} — Resonance Apps`;
  if (!title) {
    fail(`Title present (${path})`, "no <title> in SSR HTML");
  } else if (title !== expectedTitle) {
    fail(`Title matches registry (${path})`, `got ${JSON.stringify(title)}, want ${JSON.stringify(expectedTitle)}`);
  } else {
    pass(`Title matches registry (${path})`, title);
    titleSeen.push(title);
  }

  // Meta description carries the tagline plus the same live/pilot access
  // meaning shown by the page and social metadata.
  const desc = extractMetaDescription(res.body);
  const expectedDescription = appDetailDescription(entry);
  if (!desc) {
    fail(`Meta description present (${path})`, "no <meta name=description>");
  } else if (desc !== expectedDescription) {
    fail(
      `Meta description matches status contract (${path})`,
      `got ${JSON.stringify(desc)}, want ${JSON.stringify(expectedDescription)}`,
    );
  } else {
    pass(`Meta description matches status contract (${path})`);
  }

  // All three capability card titles render server-side.
  const missingCaps = CAPABILITY_TITLES[key].filter((t) => !res.body.includes(t));
  if (missingCaps.length > 0) {
    fail(
      `Capability highlights render (${path})`,
      `missing: ${missingCaps.map((t) => JSON.stringify(t)).join(", ")}`,
    );
  } else {
    pass(`Capability highlights render (${path})`, `${CAPABILITY_TITLES[key].length} cards`);
  }

  // External "Open <app>" link is present with safe rel + target.
  // All-Access points at the hub /pricing so target/rel guarantees don't
  // apply the same way; assert the URL is present instead.
  if (key === "all_access") {
    if (!res.body.includes(entry.url)) {
      fail(`External app URL rendered (${path})`, `missing ${entry.url}`);
    } else {
      pass(`External app URL rendered (${path})`, entry.url);
    }
  } else {
    const anchorRe = new RegExp(
      `<a\\b[^>]*\\bhref=["']${entry.url.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}["'][^>]*>`,
      "i",
    );
    const anchor = res.body.match(anchorRe);
    if (!anchor) {
      fail(`External app link rendered (${path})`, `no <a href="${entry.url}">`);
    } else {
      const tag = anchor[0];
      const missing: string[] = [];
      if (!/\btarget=["']_blank["']/i.test(tag)) missing.push('target="_blank"');
      if (!/\brel=["'][^"']*\bnoopener\b[^"']*["']/i.test(tag)) missing.push("rel=noopener");
      if (!/\brel=["'][^"']*\bnoreferrer\b[^"']*["']/i.test(tag)) missing.push("rel=noreferrer");
      if (missing.length > 0) {
        fail(`External app link is safe (${path})`, `anchor missing: ${missing.join(", ")}`);
      } else {
        pass(`External app link is safe (${path})`, entry.url);
      }
    }
  }
}

// Every app must ship a distinct <title> so social embeds and search
// engines treat them as separate documents.
if (titleSeen.length >= 2) {
  const unique = new Set(titleSeen);
  if (unique.size !== titleSeen.length) {
    fail("App detail pages have distinct <title>s", `duplicates in ${JSON.stringify(titleSeen)}`);
  } else {
    pass("App detail pages have distinct <title>s", `${unique.size} unique`);
  }
}

// --- 2. Invalid key returns not-found ----------------------------------------

try {
  const res = await get("/apps/definitely-not-a-real-app");
  const isNotFoundStatus = res.status === 404;
  const isNotFoundBody = res.status === 200 && /App not found/i.test(res.body);
  if (isNotFoundStatus || isNotFoundBody) {
    pass("Invalid /apps/<key> returns not-found", `status ${res.status}`);
  } else {
    fail(
      "Invalid /apps/<key> returns not-found",
      `status ${res.status}, no "App not found" marker in body`,
    );
  }
} catch (err) {
  fail("Invalid /apps/<key> fetch", (err as Error).message);
}

// --- summary -----------------------------------------------------------------

console.log(`\n${passes.length}/${passes.length + failures.length} passed (base: ${BASE})`);
if (failures.length > 0) {
  console.error(`\n${failures.length} failure(s):`);
  for (const f of failures) console.error(`  - ${f.name}: ${f.detail}`);
  process.exit(1);
}
