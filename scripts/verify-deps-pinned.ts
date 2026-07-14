#!/usr/bin/env bun
/**
 * Prebuild dependency-pinning guard.
 *
 * 1. Runs `bun install --frozen-lockfile` so a stale lockfile fails fast
 *    (frozen mode won't rewrite bun.lock — any drift surfaces immediately).
 * 2. Runs `scripts/verify-pinned-deps.ts`     — package.json entries are
 *    exact versions AND match bun.lock's resolved versions.
 * 3. Runs `scripts/verify-lockfile-consistency.ts` — overrides / package.json
 *    ↔ lockfile are internally consistent.
 *
 * On failure, prints a single clear remediation block so contributors know
 * exactly what to run without hunting through raw script output.
 */
import { spawnSync } from "node:child_process";

type Step = { label: string; cmd: string; args: string[] };

const STEPS: Step[] = [
  {
    label: "bun install --frozen-lockfile",
    cmd: "bun",
    args: ["install", "--frozen-lockfile"],
  },
  {
    label: "verify package.json pins are exact + match bun.lock",
    cmd: "bun",
    args: ["run", "scripts/verify-pinned-deps.ts"],
  },
  {
    label: "verify bun.lock ↔ package.json internal consistency",
    cmd: "bun",
    args: ["run", "scripts/verify-lockfile-consistency.ts"],
  },
];

function run(step: Step): boolean {
  process.stdout.write(`\n▶ ${step.label}\n`);
  const r = spawnSync(step.cmd, step.args, { stdio: "inherit" });
  return r.status === 0;
}

function fail(step: Step): never {
  const bar = "─".repeat(72);
  process.stderr.write(
    `\n${bar}\n` +
      `❌ Dependency pinning check FAILED at: ${step.label}\n` +
      `${bar}\n\n` +
      `Every dependency in package.json must be pinned to an EXACT version\n` +
      `(no ^, ~, >=, ranges, *, or "latest"), and bun.lock must resolve to\n` +
      `that same version. Fix locally with:\n\n` +
      `  1. Replace any \`^x.y.z\` / \`~x.y.z\` in package.json with the exact\n` +
      `     version currently in bun.lock.\n` +
      `  2. Re-sync overrides + lockfile:\n\n` +
      `       bun run scripts/sync-overrides-from-lock.ts\n` +
      `       bun install\n\n` +
      `  3. Re-run this check:\n\n` +
      `       bun run scripts/verify-deps-pinned.ts\n\n` +
      `  4. Commit BOTH package.json and bun.lock in the same commit.\n\n` +
      `${bar}\n`,
  );
  process.exit(1);
}

for (const step of STEPS) {
  if (!run(step)) fail(step);
}

process.stdout.write("\n✅ Dependencies are pinned and lockfile is consistent.\n");
