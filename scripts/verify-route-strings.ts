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
 *   1. Parses `src/routeTree.gen.ts` for the full set of registered route
 *      paths (including `$param` and `$` splat segments).
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

function loadRoutePatterns(): string[] {
  const src = readFileSync(ROUTE_TREE, "utf8");
  const patterns = new Set<string>();
  // Match `path: '/...'` entries in the generated tree.
  const re = /path:\s*'(\/[^']*)'/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) patterns.add(m[1]);
  // Always allow root.
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

function scanFile(file: string, matchers: RegExp[]): Hit[] {
  const src = readFileSync(file, "utf8");
  const lines = src.split("\n");
  const hits: Hit[] = [];
  for (const re of SCAN_PATTERNS) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) {
      const path = m[1];
      if (ALLOWLIST_EXACT.has(path)) continue;
      if (ALLOWLIST_PREFIXES.some((p) => path.startsWith(p))) continue;
      if (matchers.some((r) => r.test(path))) continue;
      // Compute line number.
      const upto = src.slice(0, m.index).split("\n");
      const line = upto.length;
      hits.push({
        file: relative(REPO_ROOT, file),
        line,
        path,
        context: (lines[line - 1] ?? "").trim().slice(0, 160),
      });
    }
  }
  return hits;
}

function main(): void {
  const patterns = loadRoutePatterns();
  const matchers = patterns.map(toRegex);
  const files = walk(SRC_DIR);
  const hits: Hit[] = [];
  for (const f of files) hits.push(...scanFile(f, matchers));

  if (hits.length === 0) {
    console.log(
      `✓ verify-route-strings: scanned ${files.length} files against ${patterns.length} routes — no invalid paths.`,
    );
    return;
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
      ` prefix to ALLOWLIST_PREFIXES in scripts/verify-route-strings.ts if it` +
      ` is intentionally a non-route absolute URL.`,
  );
  process.exit(1);
}

main();
