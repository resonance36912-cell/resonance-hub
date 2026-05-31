#!/usr/bin/env bun
/**
 * verify-discernment-usage.ts
 *
 * CI guard: every server-side content-generation route in the suite MUST call
 * `assertBriefDiscernment` before producing paid output.
 *
 * The Hub itself does not host generation routes; this verifier exists so the
 * shared contract is enforced wherever the Hub's `discernment-guard` is used.
 * It scans for files matching:
 *
 *    src/**\/*generate*.functions.ts
 *    src/**\/*generate*.server.ts
 *    src/routes/api/**\/*generate*.ts
 *
 * Each match must contain `assertBriefDiscernment(`.
 * If no candidate files exist (current Hub state), the verifier passes with a
 * note — so the script is safe to drop into any spoke repo unchanged.
 */

import { readdirSync, statSync, readFileSync, existsSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const SRC = join(ROOT, "src");

const FILE_PATTERN = /generate.*\.(functions|server)\.tsx?$/i;
const API_GEN_PATTERN = /\/api\/.*generate[^/]*\.tsx?$/i;
const REQUIRED_CALL = "assertBriefDiscernment(";

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    let s;
    try {
      s = statSync(full);
    } catch {
      continue;
    }
    if (s.isDirectory()) {
      if (name === "node_modules" || name.startsWith(".")) continue;
      walk(full, out);
    } else if (s.isFile()) {
      const rel = relative(ROOT, full).replace(/\\/g, "/");
      if (FILE_PATTERN.test(rel) || API_GEN_PATTERN.test(rel)) {
        out.push(rel);
      }
    }
  }
  return out;
}

const candidates = walk(SRC);

if (candidates.length === 0) {
  console.log(
    "✅ verify-discernment-usage: no content-generation routes found in this repo (Hub). Skipping.",
  );
  process.exit(0);
}

const violations: string[] = [];
for (const file of candidates) {
  const src = readFileSync(join(ROOT, file), "utf8");
  if (!src.includes(REQUIRED_CALL)) {
    violations.push(file);
  }
}

if (violations.length > 0) {
  console.error("❌ Discernment guard missing in generation routes:");
  for (const v of violations) {
    console.error(
      `   - ${v}\n     Add: import { assertBriefDiscernment } from "@/lib/discernment-guard";`,
    );
  }
  process.exit(1);
}

console.log(
  `✅ verify-discernment-usage: ${candidates.length} generation route(s) call assertBriefDiscernment.`,
);
