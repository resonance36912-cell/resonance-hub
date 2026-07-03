#!/usr/bin/env bun
/**
 * Refresh `overrides` and `pnpm.overrides` in package.json to the highest
 * version of each override key currently resolved in bun.lock.
 *
 * Rationale
 * ---------
 * `overrides` exist to force-upgrade transitive deps past vulnerable
 * versions (undici, ws, vite, etc.). Dependabot does not update `overrides`
 * on its own. When a direct dep bump pulls in a newer safe version of an
 * overridden transitive, we still want the override pin to advance — both
 * so `verify-pinned-deps.ts` stays truthful and so `bun audit` doesn't
 * ratchet backwards on the next fresh install.
 *
 * Strategy
 * --------
 *   1. Parse bun.lock (JSONC) and collect every resolved version of each
 *      overridden package name.
 *   2. Pick the highest semver-comparable version.
 *   3. Rewrite package.json's `overrides` and `pnpm.overrides` in place.
 *   4. Never downgrade — if the lock has an older version than what's
 *      pinned, leave the pin alone and warn.
 *
 * Usage
 * -----
 *   bun run scripts/sync-overrides-from-lock.ts          # rewrites file
 *   bun run scripts/sync-overrides-from-lock.ts --check  # exit 1 on drift
 */
import { readFileSync, writeFileSync } from "node:fs";

const CHECK_ONLY = process.argv.includes("--check");

// --- Load package.json --------------------------------------------------
const pkgPath = "package.json";
const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));

const overrideKeys = new Set<string>([
  ...Object.keys(pkg.overrides ?? {}),
  ...Object.keys(pkg.pnpm?.overrides ?? {}),
]);

if (overrideKeys.size === 0) {
  console.log("No overrides declared — nothing to sync.");
  process.exit(0);
}

// --- Load bun.lock (JSONC: comments + trailing commas) ------------------
// bun.lock is trusted local project state, not untrusted input.
const lockRaw = readFileSync("bun.lock", "utf8");
const lock = new Function(`return (${lockRaw})`)();

// bun.lock v1 shape: packages: { "name": ["name@version", ...] | { ... } }
const lockPkgs: Record<string, unknown> = lock.packages ?? {};

// Collect ALL resolved versions per name (a package may appear multiple times
// under different keys, e.g. "vite" and "vite/foo"). We scan every entry.
const resolvedByName = new Map<string, Set<string>>();

function record(name: string, version: string) {
  if (!overrideKeys.has(name)) return;
  if (/^(workspace:|link:|file:|github:|git\+|https?:|npm:)/.test(version)) return;
  if (!resolvedByName.has(name)) resolvedByName.set(name, new Set());
  resolvedByName.get(name)!.add(version);
}

for (const [key, entry] of Object.entries(lockPkgs)) {
  const specKey = Array.isArray(entry)
    ? entry[0]
    : ((entry as { key?: string })?.key ?? null);
  if (typeof specKey === "string") {
    // "@scope/name@version" or "name@version"
    const at = specKey.lastIndexOf("@");
    if (at > 0) {
      const name = specKey.slice(0, at);
      const version = specKey.slice(at + 1);
      record(name, version);
    }
  }
  // Fall back to the map key itself (bare package name → its resolved chain).
  const bareAt = key.lastIndexOf("@");
  if (bareAt > 0) {
    record(key.slice(0, bareAt), key.slice(bareAt + 1));
  }
}

// --- Semver comparator (strict X.Y.Z[-pre]) -----------------------------
function cmpSemver(a: string, b: string): number {
  const parse = (s: string) => {
    const [main, pre] = s.split("-", 2);
    const parts = main.split(".").map((n) => Number.parseInt(n, 10) || 0);
    while (parts.length < 3) parts.push(0);
    return { parts, pre: pre ?? "" };
  };
  const A = parse(a);
  const B = parse(b);
  for (let i = 0; i < 3; i++) {
    if (A.parts[i] !== B.parts[i]) return A.parts[i] - B.parts[i];
  }
  // Release > prerelease.
  if (!A.pre && B.pre) return 1;
  if (A.pre && !B.pre) return -1;
  return A.pre.localeCompare(B.pre);
}

function highest(versions: Set<string>): string {
  return [...versions].sort(cmpSemver).at(-1)!;
}

// --- Compute new pins ---------------------------------------------------
const changes: string[] = [];
const warnings: string[] = [];

function rewrite(section: Record<string, string> | undefined, label: string) {
  if (!section) return;
  for (const name of Object.keys(section)) {
    const found = resolvedByName.get(name);
    if (!found || found.size === 0) {
      warnings.push(`${label}.${name}: not found in bun.lock — leaving as "${section[name]}"`);
      continue;
    }
    const currentPin = section[name].replace(/^[\^~]/, "");
    const target = highest(found);
    if (target === currentPin) continue;
    if (cmpSemver(target, currentPin) < 0) {
      warnings.push(
        `${label}.${name}: lockfile has ${target} which is OLDER than pin ${currentPin} — refusing to downgrade`,
      );
      continue;
    }
    section[name] = target;
    changes.push(`${label}.${name}: ${currentPin} → ${target}`);
  }
}

rewrite(pkg.overrides, "overrides");
rewrite(pkg.pnpm?.overrides, "pnpm.overrides");

// --- Report / write -----------------------------------------------------
for (const w of warnings) console.warn("!", w);

if (changes.length === 0) {
  console.log("✓ overrides already in sync with bun.lock");
  process.exit(0);
}

if (CHECK_ONLY) {
  console.error("✖ overrides are out of sync with bun.lock:");
  for (const c of changes) console.error("  -", c);
  console.error("\nRun `bun run scripts/sync-overrides-from-lock.ts` to fix.");
  process.exit(1);
}

writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
console.log("✓ Updated overrides:");
for (const c of changes) console.log("  -", c);
