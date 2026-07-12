#!/usr/bin/env bun
/**
 * One-shot codemod: rewrite hardcoded route string literals in src/ to use
 * the named constants in src/lib/routes.ts. Safe to re-run — it only touches
 * exact matches for statically-registered routes.
 *
 * Rewrites:
 *   to="/pricing"                  -> to={ROUTES.pricing}
 *   to: "/admin/login"             -> to: ROUTES.adminLogin
 *   href="/pricing"  (only inside redirect/navigate call args)
 *
 * Skips:
 *   - src/lib/routes.ts (source of truth)
 *   - src/routeTree.gen.ts
 *   - src/components/BackToHubHeader.tsx (documented literal marker file)
 *   - dynamic-param paths (contain `$`) — those need `params={...}` typing
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROUTES_SRC = readFileSync("src/lib/routes.ts", "utf8");
const NAME_BY_PATH = new Map<string, string>();
for (const m of ROUTES_SRC.matchAll(
  /(\w+):\s*routePath\("([^"]+)"\)/g,
)) {
  NAME_BY_PATH.set(m[2], m[1]);
}
// Sort longest-first so `/admin/login` matches before `/admin`.
const PATHS = [...NAME_BY_PATH.keys()].sort((a, b) => b.length - a.length);

const SKIP_FILES = new Set([
  "src/lib/routes.ts",
  "src/routeTree.gen.ts",
  "src/components/BackToHubHeader.tsx",
]);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (/\.(tsx?|jsx?)$/.test(entry)) out.push(full);
  }
  return out;
}

function escapePath(p: string): string {
  return p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const changed: string[] = [];

for (const file of walk("src")) {
  const rel = relative(".", file);
  if (SKIP_FILES.has(rel)) continue;
  let src = readFileSync(file, "utf8");
  const before = src;
  const usedNames = new Set<string>();

  for (const path of PATHS) {
    const name = NAME_BY_PATH.get(path)!;
    const p = escapePath(path);
    // JSX attribute:  to="/path"  or  to='/path'
    const jsxRe = new RegExp(`\\bto=(["'])${p}\\1`, "g");
    src = src.replace(jsxRe, () => {
      usedNames.add(name);
      return `to={ROUTES.${name}}`;
    });
    // Object literal:  to: "/path"
    const objRe = new RegExp(`\\bto:\\s*(["'])${p}\\1`, "g");
    src = src.replace(objRe, () => {
      usedNames.add(name);
      return `to: ROUTES.${name}`;
    });
  }

  if (src === before) continue;

  // Ensure ROUTES import.
  if (!/from\s+["']@\/lib\/routes["']/.test(src)) {
    // Insert after the last import statement.
    const importRe = /^import[^\n]+\n(?![\s]*import)/m;
    const match = src.match(/(^import[^\n]+\n)+/m);
    if (match) {
      const insertAt = match.index! + match[0].length;
      src =
        src.slice(0, insertAt) +
        `import { ROUTES } from "@/lib/routes";\n` +
        src.slice(insertAt);
    } else {
      src = `import { ROUTES } from "@/lib/routes";\n` + src;
    }
  } else if (!/\bROUTES\b/.test(src.match(/import[^\n]+@\/lib\/routes[^\n]+/)![0])) {
    // Import exists but doesn't include ROUTES — add it.
    src = src.replace(
      /import\s+\{([^}]+)\}\s+from\s+(["'])@\/lib\/routes\2/,
      (_m, names, q) => `import { ROUTES,${names}} from ${q}@/lib/routes${q}`,
    );
  }

  writeFileSync(file, src);
  changed.push(rel);
}

console.log(`Rewrote ${changed.length} file(s).`);
for (const f of changed) console.log(`  ${f}`);
