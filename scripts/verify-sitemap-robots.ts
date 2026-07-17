#!/usr/bin/env bun
/**
 * Verify sitemap.xml and robots.txt include every Resonance app and the
 * hub pricing routes that back each pricing anchor.
 *
 * Fetches from BASE_URL (default http://localhost:8080). Exits non-zero on
 * any missing entry so CI fails loudly.
 */
import { APP_REGISTRY } from "../src/lib/app-registry";

const BASE = (process.env.BASE_URL ?? "http://localhost:8080").replace(/\/$/, "");

// Hub pricing routes (each redirects to /pricing#<anchor>). One per paid app
// EXCEPT `all_access`, which is a bundle SKU without its own pricing route.
const HUB_PRICING_PATHS = [
  "/pricing",
  "/epublisher/pricing",
  "/creative-studio/pricing",
  "/sync-vision/pricing",
  "/youtube-optimizer/pricing",
];

// Anchors on /pricing that MUST be reachable (matches ids in pricing.tsx).
const PRICING_ANCHORS = [
  "epublisher",
  "creative-studio",
  "sync-vision",
  "youtube-optimizer",
];

// Canonical hub host that sitemap <loc> entries MUST use for the homepage
// and legal routes. Mismatched hosts break canonical signals for crawlers.
const CANONICAL_HOST = "https://reson8.life";
const CANONICAL_PATHS = [
  "/",
  "/legal",
  "/legal/privacy",
  "/legal/terms",
  "/legal/cookies",
];

// Every paid spoke's public URL (canonical marketing / app URL).
const SPOKE_URLS = Object.values(APP_REGISTRY)
  .filter((e) => e.key !== "all_access")
  .map((e) => e.publicUrl);

type Failure = { file: string; missing: string };
const failures: Failure[] = [];

async function fetchResponse(path: string): Promise<Response> {
  const res = await fetch(new URL(path, BASE).toString(), { redirect: "manual" });
  return res;
}

async function fetchText(path: string): Promise<string> {
  const res = await fetch(new URL(path, BASE).toString());
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}`);
  return res.text();
}

// ---- reachability ------------------------------------------------------
console.log("reachability:");
for (const path of ["/robots.txt", "/sitemap.xml"]) {
  const res = await fetchResponse(path);
  if (res.status === 200) {
    console.log(`  ✓ ${path} → 200`);
  } else {
    console.log(`  ✗ ${path} → ${res.status}`);
    failures.push({ file: path, missing: `HTTP 200 (got ${res.status})` });
  }
}

// ---- sitemap Content-Type ----------------------------------------------
{
  const res = await fetchResponse("/sitemap.xml");
  const ct = res.headers.get("content-type") ?? "";
  if (!/xml/i.test(ct)) {
    failures.push({ file: "sitemap.xml", missing: `XML Content-Type (got '${ct}')` });
  } else {
    console.log(`  ✓ sitemap.xml Content-Type: ${ct}`);
  }
}

// ---- robots.txt --------------------------------------------------------
console.log("robots.txt:");
const robots = await fetchText("/robots.txt");
if (!/^User-agent:\s*\*/m.test(robots)) {
  failures.push({ file: "robots.txt", missing: "User-agent: * block" });
}
if (!/^Allow:\s*\//m.test(robots) || /^Disallow:\s*\/\s*$/m.test(robots)) {
  failures.push({ file: "robots.txt", missing: "Allow: / (or accidentally disallows all)" });
}
if (!/Sitemap:\s*https?:\/\/\S+\/sitemap\.xml/i.test(robots)) {
  failures.push({ file: "robots.txt", missing: "Sitemap: ...sitemap.xml directive" });
}
console.log(failures.length === 0 ? "  ✓ passes core checks" : "  ✗ see failures below");

// ---- sitemap.xml -------------------------------------------------------
console.log("\nsitemap.xml:");
const sitemap = await fetchText("/sitemap.xml");
const locs = Array.from(sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)).map((m) => m[1].trim());

function has(needle: string): boolean {
  return locs.some((l) => l.endsWith(needle) || l === needle);
}

// Hub pricing paths must appear as absolute URLs ending with the path.
for (const path of HUB_PRICING_PATHS) {
  if (has(path)) {
    console.log(`  ✓ ${path}`);
  } else {
    console.log(`  ✗ missing hub path: ${path}`);
    failures.push({ file: "sitemap.xml", missing: `hub path ${path}` });
  }
}

// Every paid spoke's public URL must be listed.
for (const url of SPOKE_URLS) {
  if (locs.includes(url)) {
    console.log(`  ✓ ${url}`);
  } else {
    console.log(`  ✗ missing spoke URL: ${url}`);
    failures.push({ file: "sitemap.xml", missing: `spoke URL ${url}` });
  }
}

// ---- canonical homepage + legal URLs -----------------------------------
// Each MUST appear as an absolute URL under the canonical hub host so
// crawlers get one canonical signal — no host drift, no bare paths.
console.log("\ncanonical hub URLs (homepage + legal):");
for (const path of CANONICAL_PATHS) {
  const expected = `${CANONICAL_HOST}${path === "/" ? "/" : path}`;
  if (locs.includes(expected)) {
    console.log(`  ✓ ${expected}`);
  } else {
    // Detect wrong-host duplicates so the failure message is actionable.
    const drift = locs.filter((l) => l.endsWith(path) && !l.startsWith(CANONICAL_HOST));
    const detail = drift.length ? ` (found on wrong host: ${drift.join(", ")})` : "";
    console.log(`  ✗ missing canonical: ${expected}${detail}`);
    failures.push({ file: "sitemap.xml", missing: `canonical ${expected}${detail}` });
  }
}

// robots.txt Sitemap: directive must point at the canonical host too.
{
  const m = robots.match(/Sitemap:\s*(\S+)/i);
  const expected = `${CANONICAL_HOST}/sitemap.xml`;
  if (!m) {
    // already reported above
  } else if (m[1].trim() !== expected) {
    console.log(`  ✗ robots Sitemap host mismatch: ${m[1]} (want ${expected})`);
    failures.push({ file: "robots.txt", missing: `Sitemap ${expected} (got ${m[1]})` });
  } else {
    console.log(`  ✓ robots Sitemap → ${m[1]}`);
  }
}

// ---- pricing anchors ---------------------------------------------------
console.log("\npricing anchors on /pricing:");
const pricingHtml = await fetchText("/pricing");
for (const id of PRICING_ANCHORS) {
  // id="anchor" appears in the rendered SSR HTML.
  const re = new RegExp(`id=["']${id}["']`);
  if (re.test(pricingHtml)) {
    console.log(`  ✓ #${id}`);
  } else {
    console.log(`  ✗ missing anchor: #${id}`);
    failures.push({ file: "/pricing", missing: `anchor #${id}` });
  }
}

console.log("");
if (failures.length > 0) {
  console.error(`FAIL — ${failures.length} problem(s):`);
  for (const f of failures) console.error(`  - ${f.file}: ${f.missing}`);
  process.exit(1);
}
console.log(`OK — sitemap, robots.txt, and pricing anchors all present (base: ${BASE})`);
