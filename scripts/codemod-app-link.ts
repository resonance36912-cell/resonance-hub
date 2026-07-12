#!/usr/bin/env bun
/**
 * One-shot codemod: rewrite `<Link>` JSX usages that navigate within the
 * app to `<AppLink>`, and adjust imports.
 *
 * Skipped:
 *  - `src/components/AppLink.tsx` (defines the wrapper)
 *  - `src/components/BackToHubHeader.tsx` (marker file — verify script
 *    grep-matches on the raw string `<Link ... to="/"`)
 *  - `src/routes/__root.tsx` (root layout — pre-router infra)
 */
import { readdirSync, readFileSync, writeFileSync, statSync } from "fs";
import { join, relative } from "path";

const ROOT = process.cwd();
const SKIP = new Set([
  "src/components/AppLink.tsx",
  "src/components/BackToHubHeader.tsx",
  "src/routes/__root.tsx",
]);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const s = statSync(full);
    if (s.isDirectory()) walk(full, out);
    else if (entry.endsWith(".tsx")) out.push(full);
  }
  return out;
}

let changed = 0;
for (const abs of walk(join(ROOT, "src"))) {
  const rel = relative(ROOT, abs).replaceAll("\\", "/");
  if (SKIP.has(rel)) continue;

  const original = readFileSync(abs, "utf8");
  if (!/<Link[\s/>]/.test(original)) continue;

  let next = original;
  // Swap JSX element name only — leaves identifier `Link` references (e.g.
  // `Link as _`) alone.
  next = next.replace(/<Link(\s|\/|>)/g, "<AppLink$1");
  next = next.replace(/<\/Link>/g, "</AppLink>");

  // Ensure AppLink import is present.
  if (!/from ["']@\/components\/AppLink["']/.test(next)) {
    // Insert after the last import line.
    const importRe = /^import .+?;$/gm;
    let lastEnd = 0;
    for (const m of next.matchAll(importRe)) {
      lastEnd = (m.index ?? 0) + m[0].length;
    }
    const insertion = `\nimport { AppLink } from "@/components/AppLink";`;
    next = next.slice(0, lastEnd) + insertion + next.slice(lastEnd);
  }

  // If `Link` is no longer used as an identifier anywhere, strip it from
  // the TanStack import list.
  const stillUsesLinkIdent = /\bLink\b/.test(
    next
      // ignore the import line itself for this check
      .replace(/import\s*\{[^}]*\}\s*from\s*["']@tanstack\/react-router["'];?/g, "")
  );
  if (!stillUsesLinkIdent) {
    next = next.replace(
      /import\s*\{([^}]*)\}\s*from\s*(["']@tanstack\/react-router["']);?/g,
      (_full, inner: string, src: string) => {
        const names = inner
          .split(",")
          .map((s) => s.trim())
          .filter((s) => s && s !== "Link" && s !== "Link,");
        if (names.length === 0) return "";
        return `import { ${names.join(", ")} } from ${src};`;
      }
    );
  }

  if (next !== original) {
    writeFileSync(abs, next);
    changed++;
    console.log("  ~", rel);
  }
}

console.log(`\nRewrote ${changed} file(s).`);
