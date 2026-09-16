#!/usr/bin/env bun
/**
 * verify-route-strings.ts
 *
 * Belt-and-braces guard for hardcoded route strings.
 *
 * `tsc --noEmit` already catches invalid TanStack `<Link to>`, `navigate({ to })`,
 * and `redirect({ to })` targets because those props are typed against the
 * generated route registry. But plain `<a href="/foo">`, string literals passed
 * through `window.location.href = "/foo"`, and template strings assembled
 * before hitting the router bypass that check.
 *
 * This script:
 *   1. Parses `src/routeTree.gen.ts` for the full set of registered `to`
 *      navigation paths (including `$param` and `$` splat segments).
 *   2. Scans `src/` for internal-looking absolute paths in JSX `href=`,
 *      `to=`, `navigate("/...")`, `redirect({ to: "/..." })`, and
 *      `window.location.*` assignments.
 *   3. Fails if any path does not resolve to a known route.
 *
 * A short allowlist covers non-route absolute paths that legitimately live in
 * the app (static asset URLs, API base fragments, external issuer paths).
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const REPO_ROOT = process.cwd();
const SRC_DIR = join(REPO_ROOT, "src");
const ROUTE_TREE = join(SRC_DIR, "routeTree.gen.ts");

// Absolute paths that are NOT app routes and should be ignored by this scan.
// Keep tight — every entry is a hole in the check.
const ALLOWLIST_PREFIXES = [
  "/auth/v1", // Supabase issuer URL fragment
  "/rest/v1", // Supabase REST fragment
  "/functions/v1", // Supabase functions fragment
  "/storage/v1", // Supabase storage fragment
  "/assets/", // Vite build assets
  "/favicon", // /favicon.ico, /favicon.svg
  "/robots.txt",
  "/manifest.json",
  "/og-", // /og-image.png etc.
  "/placeholder", // /placeholder.svg
];

const ALLOWLIST_EXACT = new Set<string>(["/", "//"]);

// External hosts trusted for intentional non-route `href`s. Match is exact
// on the URL host or on a `.suffix` (e.g. `github.com` matches
// `github.com` and `docs.github.com`). Prefer `DocsLink` in app code — this
// list exists so scanning stays green even when a legacy inline `<a>` slips
// through, and so verify catches unknown outbound domains loudly.
const ALLOWLIST_EXTERNAL_HOSTS = [
  "github.com",
  "raw.githubusercontent.com",
  "lovable.dev",
  "lovable.app",
  "docs.lovable.dev",
  "supabase.com",
  "supabase.co",
  "payfast.co.za",
  "reson8.life",
  // Ecosystem / spoke apps
  "epublisher.reson8.life",
  "creative.reson8.life",
  "sync.reson8.life",
  "epublisher.life",
  "youtube-optimizer.life",
  "resonance-podcast.com",
  "medi-tech.co.za",
  "career-compass.org",
  // Common third parties referenced in marketing pages
  "youtube.com",
  "youtu.be",
  "keepachangelog.com",
];



function loadRoutePatterns(): string[] {
  const src = readFileSync(ROUTE_TREE, "utf8");
  const patterns = new Set<string>();
  // `FileRoutesByTo` is the router's canonical navigation registry. It uses
  // "/admin" for the index route where `fullPath` is "/admin/".
  const byToBlock = src.match(/export interface FileRoutesByTo \{([\s\S]*?)\n\}/)?.[1] ?? "";
  for (const m of byToBlock.matchAll(/^\s*'(\/[^']*)':\s*typeof\s+\w+Route/gm)) {
    patterns.add(m[1]);
  }
  patterns.add("/");
  return [...patterns];
}

function toRegex(pattern: string): RegExp {
  // Convert TanStack route pattern to a matcher.
  // `$param` -> one non-slash segment; `$` (splat) -> anything.
  const escaped = pattern
    .split("/")
    .map((seg) => {
      if (seg === "$") return ".*";
      if (seg.startsWith("$")) return "[^/]+";
      return seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    })
    .join("/");
  return new RegExp(`^${escaped}$`);
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "routeTree.gen.ts") continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (/\.(tsx?|jsx?)$/.test(entry)) out.push(full);
  }
  return out;
}

interface Hit {
  file: string;
  line: number;
  path: string;
  context: string;
}

// Capture absolute paths inside string/template literals. We include `$` so
// TanStack `$param` segments survive; `${...}` interpolations in template
// literals are normalized below before matching.
const PATH_CHARS = String.raw`[^"'\`?#\s]*`;
const SCAN_PATTERNS: RegExp[] = [
  new RegExp(String.raw`\bhref\s*=\s*["'\`](\/${PATH_CHARS})`, "g"),
  new RegExp(String.raw`\bto\s*=\s*\{?\s*["'\`](\/${PATH_CHARS})`, "g"),
  new RegExp(String.raw`\bto\s*:\s*["'\`](\/${PATH_CHARS})`, "g"),
  new RegExp(String.raw`\bnavigate\s*\(\s*["'\`](\/${PATH_CHARS})`, "g"),
  new RegExp(
    String.raw`window\.location\.(?:href|assign|replace)\s*(?:=|\()\s*["'\`](\/${PATH_CHARS})`,
    "g",
  ),
];

function normalizePath(raw: string): string {
  // Template-literal `${expr}` → `$x` (opaque single-segment param).
  return raw.replace(/\$\{[^}]*\}/g, "$x");
}

function isAllowedExternalHost(host: string): boolean {
  const h = host.toLowerCase();
  return ALLOWLIST_EXTERNAL_HOSTS.some(
    (allowed) => h === allowed || h.endsWith(`.${allowed}`),
  );
}

// Capture full absolute http(s) URLs from href/to/etc. so we can allowlist
// trusted external hosts and flag unknown ones.
const EXTERNAL_URL_PATTERNS: RegExp[] = [
  /\bhref\s*=\s*["'`](https?:\/\/[^"'`\s]+)/g,
  /\bto\s*=\s*\{?\s*["'`](https?:\/\/[^"'`\s]+)/g,
  /window\.location\.(?:href|assign|replace)\s*(?:=|\()\s*["'`](https?:\/\/[^"'`\s]+)/g,
];

function scanFile(file: string, matchers: RegExp[]): Hit[] {
  const src = readFileSync(file, "utf8");
  const lines = src.split("\n");
  const hits: Hit[] = [];
  for (const re of SCAN_PATTERNS) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) {
      const path = normalizePath(m[1]);
      if (ALLOWLIST_EXACT.has(path)) continue;
      if (ALLOWLIST_PREFIXES.some((p) => path.startsWith(p))) continue;
      const upto = src.slice(0, m.index).split("\n");
      const line = upto.length;
      // Normalization rule: internal route strings must NOT end with "/"
      // (except the root). A trailing slash here — e.g. "/admin/" — is what
      // let the "/admin/" literal leak back into the route union previously.
      if (path !== "/" && path.endsWith("/")) {
        hits.push({
          file: relative(REPO_ROOT, file),
          line,
          path,
          context: `[trailing slash] ${(lines[line - 1] ?? "").trim().slice(0, 150)}`,
        });
        continue;
      }
      if (matchers.some((r) => r.test(path))) continue;
      hits.push({
        file: relative(REPO_ROOT, file),
        line,
        path,
        context: (lines[line - 1] ?? "").trim().slice(0, 160),
      });
    }
  }
  for (const re of EXTERNAL_URL_PATTERNS) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) {
      const raw = m[1];
      let host = "";
      try {
        host = new URL(raw).host;
      } catch {
        continue;
      }
      if (isAllowedExternalHost(host)) continue;
      const upto = src.slice(0, m.index).split("\n");
      const line = upto.length;
      hits.push({
        file: relative(REPO_ROOT, file),
        line,
        path: raw,
        context: `[external host not allowlisted: ${host}] ${(lines[line - 1] ?? "").trim().slice(0, 130)}`,
      });
    }
  }
  return hits;
}


function writeStepSummary(hits: Hit[], filesScanned: number, routes: number) {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (!summaryPath) return;
  const lines: string[] = [];
  lines.push(`## verify-route-strings`);
  lines.push("");
  if (hits.length === 0) {
    lines.push(
      `✅ Scanned **${filesScanned}** files against **${routes}** registered routes — no invalid hrefs.`,
    );
  } else {
    lines.push(
      `❌ **${hits.length}** invalid href(s) across **${filesScanned}** files (**${routes}** routes registered).`,
    );
    lines.push("");
    lines.push("| File | Line | Path | Context |");
    lines.push("| --- | ---: | --- | --- |");
    for (const h of hits) {
      const ctx = h.context.replace(/\|/g, "\\|").slice(0, 160);
      const path = h.path.replace(/\|/g, "\\|");
      lines.push(`| \`${h.file}\` | ${h.line} | \`${path}\` | ${ctx} |`);
    }
    lines.push("");
    lines.push(
      "**Fix:** point to a real route (see `src/lib/routes.ts`), add the prefix to `ALLOWLIST_PREFIXES`, or add the host to `ALLOWLIST_EXTERNAL_HOSTS` in `scripts/verify-route-strings.ts`.",
    );
  }
  lines.push("");
  try {
    require("node:fs").appendFileSync(summaryPath, lines.join("\n") + "\n");
  } catch {
    /* non-fatal */
  }
}

function main(): void {
  const patterns = loadRoutePatterns();
  const matchers = patterns.map(toRegex);
  const files = walk(SRC_DIR);
  const hits: Hit[] = [];
  for (const f of files) hits.push(...scanFile(f, matchers));

  writeStepSummary(hits, files.length, patterns.length);

  if (hits.length === 0) {
    console.log(
      `✓ verify-route-strings: scanned ${files.length} files against ${patterns.length} routes — no invalid paths.`,
    );
    return;
  }

  // GitHub Actions annotations — one per hit, clickable in the PR diff.
  const inCi = process.env.GITHUB_ACTIONS === "true";
  if (inCi) {
    for (const h of hits) {
      const msg = `Invalid href \"${h.path}\" — ${h.context}`.replace(
        /\r?\n/g,
        " ",
      );
      console.log(`::error file=${h.file},line=${h.line}::${msg}`);
    }
  }

  console.error(
    `✗ verify-route-strings: ${hits.length} invalid route string(s) found.\n`,
  );
  for (const h of hits) {
    console.error(`  ${h.file}:${h.line}  ${h.path}`);
    console.error(`    ${h.context}`);
  }
  console.error(
    `\nFix by pointing to a real route (see src/lib/routes.ts) or add the` +
      ` prefix to ALLOWLIST_PREFIXES / host to ALLOWLIST_EXTERNAL_HOSTS in` +
      ` scripts/verify-route-strings.ts if the target is intentionally non-app.`,
  );
  process.exit(1);
}

main();

