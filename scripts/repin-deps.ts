#!/usr/bin/env bun
/**
 * One-command lockfile + package.json re-pin.
 *
 *   bun run scripts/repin-deps.ts
 *
 * Steps:
 *   1. Delete bun.lock (and legacy bun.lockb) and run `bun install` — Bun
 *      re-resolves every dep to the latest version allowed by the current
 *      package.json spec and writes a fresh lockfile.
 *   2. Rewrite every entry in package.json's `dependencies` and
 *      `devDependencies` to the EXACT version bun.lock just resolved.
 *      Ranges (^, ~, *, "latest", protocols like workspace:/link:) are left
 *      alone only for protocol-prefixed specs; everything else is pinned.
 *   3. Run `bun install` again so the lockfile reflects the pinned
 *      package.json (usually a no-op, but guarantees drift is zero).
 *   4. Sync pnpm.overrides from what actually resolved.
 *   5. Run the verifier so the script fails loudly if anything is still off.
 *
 * Commit BOTH package.json and bun.lock in the same commit afterward.
 */
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const EXEMPT_PROTO = /^(?:workspace:|link:|file:|github:|git\+|https?:|npm:|catalog:)/;

function run(cmd: string, args: string[]) {
  process.stdout.write(`\n▶ ${cmd} ${args.join(" ")}\n`);
  const r = spawnSync(cmd, args, { stdio: "inherit" });
  if (r.status !== 0) {
    process.stderr.write(`\n✖ Command failed: ${cmd} ${args.join(" ")}\n`);
    process.exit(r.status ?? 1);
  }
}

function readLockPackages(): Record<string, unknown> {
  const raw = readFileSync("bun.lock", "utf8");
  // bun.lock is JSONC (comments + trailing commas). Trusted local file.
  const lock = new Function(`return (${raw})`)();
  return (lock.packages ?? {}) as Record<string, unknown>;
}

function resolvedVersion(pkgs: Record<string, unknown>, name: string): string | null {
  const entry = pkgs[name];
  if (!entry) return null;
  const key = Array.isArray(entry) ? entry[0] : ((entry as any).key ?? (entry as any)[0]);
  if (typeof key !== "string") return null;
  const at = key.lastIndexOf("@");
  return at > 0 ? key.slice(at + 1) : null;
}

function repinSection(
  section: "dependencies" | "devDependencies",
  pkg: Record<string, any>,
  lockPkgs: Record<string, unknown>,
  changes: string[],
) {
  const deps = pkg[section] as Record<string, string> | undefined;
  if (!deps) return;
  for (const [name, spec] of Object.entries(deps)) {
    if (EXEMPT_PROTO.test(spec)) continue;
    const resolved = resolvedVersion(lockPkgs, name);
    if (!resolved) {
      process.stderr.write(`  ! ${section}.${name}: not found in bun.lock (skipping)\n`);
      continue;
    }
    if (resolved !== spec) {
      changes.push(`  - ${section}.${name}: ${spec} → ${resolved}`);
      deps[name] = resolved;
    }
  }
}

// ─── 1. Wipe lockfile and re-resolve from scratch ────────────────────────────
for (const f of ["bun.lock", "bun.lockb"]) {
  if (existsSync(f)) {
    rmSync(f);
    process.stdout.write(`✓ removed ${f}\n`);
  }
}
run("bun", ["install"]);

// ─── 2. Rewrite package.json exact-pins from bun.lock ────────────────────────
const pkgRaw = readFileSync("package.json", "utf8");
const pkg = JSON.parse(pkgRaw);
const lockPkgs = readLockPackages();
const changes: string[] = [];
repinSection("dependencies", pkg, lockPkgs, changes);
repinSection("devDependencies", pkg, lockPkgs, changes);

// Preserve trailing newline convention.
const trailingNewline = pkgRaw.endsWith("\n") ? "\n" : "";
writeFileSync("package.json", JSON.stringify(pkg, null, 2) + trailingNewline);

if (changes.length) {
  process.stdout.write(`\n✓ Re-pinned ${changes.length} package.json entr${changes.length === 1 ? "y" : "ies"}:\n`);
  for (const c of changes) process.stdout.write(`${c}\n`);
} else {
  process.stdout.write("\n✓ package.json was already fully pinned to resolved versions.\n");
}

// ─── 3. Re-install so lockfile reflects the (now exact) package.json ─────────
run("bun", ["install"]);

// ─── 4. Sync overrides from what actually resolved ───────────────────────────
run("bun", ["run", "scripts/sync-overrides-from-lock.ts"]);
run("bun", ["install"]);

// ─── 5. Final verification ───────────────────────────────────────────────────
run("bun", ["run", "scripts/verify-deps-pinned.ts"]);

process.stdout.write(
  "\n✅ Done. Commit BOTH package.json and bun.lock in the same commit:\n" +
    "   git add package.json bun.lock\n" +
    '   git commit -m "chore(deps): repin to resolved versions"\n',
);
