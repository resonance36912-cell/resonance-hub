#!/usr/bin/env bun
/**
 * Repair pass for codemod-routes-constants.ts.
 *
 * The original codemod injected `import { ROUTES } from "@/lib/routes";`
 * using a single-line regex that mis-fired on multi-line `import { ... }`
 * blocks, splitting them. This script:
 *   1. Removes every misplaced ROUTES import line.
 *   2. Reinserts it after the true end of the top-of-file import block
 *      (which may include multi-line imports and blank lines between).
 *   3. Skips files that never used ROUTES anyway.
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const IMPORT_LINE = 'import { ROUTES } from "@/lib/routes";';

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (/\.(tsx?|jsx?)$/.test(entry)) out.push(full);
  }
  return out;
}

function findEndOfImportBlock(lines: string[]): number {
  let i = 0;
  let lastImportEnd = -1;
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed.startsWith("import ")) {
      // Multi-line? Balance braces + count until we hit a `from '...';` line.
      let j = i;
      let opens = 0;
      let closes = 0;
      while (j < lines.length) {
        for (const ch of lines[j]) {
          if (ch === "{") opens++;
          else if (ch === "}") closes++;
        }
        // A single-line import ends on the same line; a multi-line one ends
        // when braces balance AND the line terminates with `;` or a
        // `from "..."` clause.
        if (opens === closes && (/;\s*$/.test(lines[j]) || /from\s+["'][^"']+["']\s*;?\s*$/.test(lines[j]))) {
          lastImportEnd = j;
          break;
        }
        j++;
      }
      i = (lastImportEnd >= i ? lastImportEnd : j) + 1;
      continue;
    }
    if (trimmed === "" || trimmed.startsWith("//")) {
      i++;
      continue;
    }
    break;
  }
  return lastImportEnd;
}

let fixed = 0;
for (const file of walk("src")) {
  const rel = relative(".", file);
  if (rel === "src/lib/routes.ts") continue;
  let src = readFileSync(file, "utf8");
  if (!src.includes("ROUTES.")) continue;

  // Strip every existing ROUTES-import line (any position).
  const stripped = src
    .split("\n")
    .filter((l) => l.trim() !== IMPORT_LINE)
    .join("\n");

  const lines = stripped.split("\n");
  const end = findEndOfImportBlock(lines);
  if (end < 0) {
    // No imports at all — prepend.
    src = IMPORT_LINE + "\n" + stripped;
  } else {
    lines.splice(end + 1, 0, IMPORT_LINE);
    src = lines.join("\n");
  }
  writeFileSync(file, src);
  fixed++;
}
console.log(`Repaired ${fixed} file(s).`);
