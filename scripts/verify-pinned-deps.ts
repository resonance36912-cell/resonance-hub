#!/usr/bin/env bun
/**
 * Enforce pinned deps: package.json must use exact versions, and every declared
 * version must match what bun.lock resolved. Prevents fresh installs from
 * silently pulling a newer (potentially vulnerable) version than what security
 * scans reviewed.
 */
import { readFileSync } from "node:fs";

type Deps = Record<string, string>;
const pkg = JSON.parse(readFileSync("package.json", "utf8"));
// bun.lock is JSONC (allows trailing commas); strip them before parsing.
const lockRaw = readFileSync("bun.lock", "utf8")
  .replace(/\/\/[^\n]*/g, "")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/,(\s*[}\]])/g, "$1");
const lock = JSON.parse(lockRaw);

const errors: string[] = [];

const RANGE = /^[\^~><=]|(?:\s-\s)|\|\|/;
const EXEMPT_PROTO = /^(?:workspace:|link:|file:|github:|git\+|https?:|npm:|catalog:)/;

function checkExact(section: string, deps: Deps | undefined) {
  if (!deps) return;
  for (const [name, spec] of Object.entries(deps)) {
    if (EXEMPT_PROTO.test(spec)) continue;
    if (RANGE.test(spec) || spec === "*" || spec === "latest") {
      errors.push(`${section}.${name}: "${spec}" is not a pinned exact version`);
    }
  }
}

checkExact("dependencies", pkg.dependencies);
checkExact("devDependencies", pkg.devDependencies);
checkExact("overrides", pkg.overrides);
checkExact("pnpm.overrides", pkg.pnpm?.overrides);

// Cross-check against bun.lock resolved versions.
// bun.lock v1 shape: { packages: { "name": ["name@version", ...] | { ... } } }
const lockPkgs: Record<string, unknown> = lock.packages ?? {};
function resolvedVersion(name: string): string | null {
  const entry = lockPkgs[name];
  if (!entry) return null;
  const key = Array.isArray(entry) ? entry[0] : (entry as any).key ?? (entry as any)[0];
  if (typeof key !== "string") return null;
  const at = key.lastIndexOf("@");
  return at > 0 ? key.slice(at + 1) : null;
}

function checkLock(section: string, deps: Deps | undefined) {
  if (!deps) return;
  for (const [name, spec] of Object.entries(deps)) {
    if (EXEMPT_PROTO.test(spec)) continue;
    const resolved = resolvedVersion(name);
    if (!resolved) {
      errors.push(`${section}.${name}: not present in bun.lock (run \`bun install\`)`);
      continue;
    }
    if (resolved !== spec) {
      errors.push(
        `${section}.${name}: package.json="${spec}" but bun.lock resolved "${resolved}" — run \`bun install\` then commit bun.lock`,
      );
    }
  }
}

checkLock("dependencies", pkg.dependencies);
checkLock("devDependencies", pkg.devDependencies);

if (errors.length) {
  console.error("✖ Pinned dependency check failed:");
  for (const e of errors) console.error("  -", e);
  process.exit(1);
}
console.log("✓ All dependencies pinned and lockfile matches package.json");
