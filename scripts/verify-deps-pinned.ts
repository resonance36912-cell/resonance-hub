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
import { auditPinsFromDisk, describeIssue, formatIssueTable, type PinIssue } from "./lib/pinned-deps";

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

/**
 * Re-audits package.json ↔ bun.lock so the remediation block names the exact
 * offenders and the version bun.lock expects. Never throws: a malformed or
 * missing bun.lock is itself a plausible reason the step failed, and the
 * generic guidance below still applies.
 */
function safeAudit(): PinIssue[] {
  try {
    return auditPinsFromDisk();
  } catch {
    return [];
  }
}

function fail(step: Step): never {
  const bar = "─".repeat(72);
  const issues = safeAudit();

  let detail = "";
  if (issues.length) {
    const plural = issues.length === 1 ? "y" : "ies";
    detail =
      `Offending entr${plural} (${issues.length}) — declared vs. what bun.lock resolves:\n\n` +
      `${formatIssueTable(issues)}\n\n` +
      issues.map((i) => `  - ${describeIssue(i)}\n`).join("") +
      `\n`;
  } else {
    detail =
      `No package.json ↔ bun.lock mismatch was detectable from the files on\n` +
      `disk, so the failure is in the install/consistency step itself — read the\n` +
      `step output above (e.g. a lockfile bun refused to install with\n` +
      `--frozen-lockfile, or overrides that shift on re-resolution).\n\n`;
  }

  process.stderr.write(
    `\n${bar}\n` +
      `❌ Dependency pinning check FAILED at: ${step.label}\n` +
      `${bar}\n\n` +
      detail +
      `Every dependency in package.json must be pinned to an EXACT version\n` +
      `(no ^, ~, >=, ranges, *, or "latest"), and bun.lock must resolve to\n` +
      `that same version. Fix locally with:\n\n` +
      `  1. Apply the exact versions listed above to package.json.\n` +
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
