#!/usr/bin/env bun
/**
 * verify-lockfile-consistency.ts
 *
 * Single source of truth for the "is the lockfile in sync with package.json,
 * including overrides?" check. Used by:
 *   - .github/workflows/dependabot-sync.yml (hard-fail on drift)
 *   - local pre-push checks (bun run verify:lockfile-consistency)
 *
 * Steps (all performed against the current working tree, no writes):
 *   1. Snapshot bun.lock + package.json.
 *   2. Run `bun install` — must NOT modify bun.lock (would mean the committed
 *      lockfile does not match package.json).
 *   3. Run `scripts/sync-overrides-from-lock.ts` — must NOT modify package.json
 *      (would mean the `overrides` block is out of date with resolved versions).
 *   4. Run `bun install` again — must NOT modify bun.lock (would mean overrides
 *      or transitive re-resolution changed the graph).
 *
 * On drift: writes diffs and both file versions to `--out-dir` (default
 * `drift-artifacts/`) and exits with a non-zero code. The workflow uploads
 * that directory as the `dependabot-sync-drift` artifact.
 */

import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

type Args = { outDir: string; skipInstall: boolean };

function parseArgs(argv: string[]): Args {
  const args: Args = { outDir: "drift-artifacts", skipInstall: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--out-dir") args.outDir = argv[++i] ?? args.outDir;
    else if (a?.startsWith("--out-dir=")) args.outDir = a.slice("--out-dir=".length);
    else if (a === "--skip-install") args.skipInstall = true;
    else if (a === "-h" || a === "--help") {
      console.log("Usage: bun scripts/verify-lockfile-consistency.ts [--out-dir=DIR] [--skip-install]");
      process.exit(0);
    } else {
      console.error(`Unknown argument: ${a}`);
      process.exit(2);
    }
  }
  return args;
}

function run(cmd: string, args: string[]): void {
  const res = spawnSync(cmd, args, { stdio: "inherit" });
  if (res.status !== 0) {
    throw new Error(`${cmd} ${args.join(" ")} exited with ${res.status ?? res.signal}`);
  }
}

function unifiedDiff(label: string, before: string, after: string): string | null {
  if (before === after) return null;
  const tmpBefore = join(process.cwd(), `.tmp.${label}.before`);
  const tmpAfter = join(process.cwd(), `.tmp.${label}.after`);
  writeFileSync(tmpBefore, before);
  writeFileSync(tmpAfter, after);
  try {
    const d = spawnSync(
      "diff",
      ["-u", "--label", `a/${label}`, "--label", `b/${label}`, tmpBefore, tmpAfter],
      { encoding: "utf8" },
    );
    if (d.error) {
      return `(diff binary unavailable — see uploaded before/after files; sizes ${before.length} vs ${after.length})`;
    }
    return d.stdout || `(diff produced no output but files differ; sizes ${before.length} vs ${after.length})`;
  } finally {
    rmSync(tmpBefore, { force: true });
    rmSync(tmpAfter, { force: true });
  }
}

type CheckResult = {
  id: string;
  label: string;
  ok: boolean;
  diff?: string;
  snippet?: string;
};

function main(): void {
  const { outDir, skipInstall } = parseArgs(process.argv.slice(2));
  const cwd = process.cwd();
  const lockPath = resolve(cwd, "bun.lock");
  const pkgPath = resolve(cwd, "package.json");

  if (!existsSync(lockPath) || !existsSync(pkgPath)) {
    console.error("bun.lock and package.json must exist at the repo root.");
    process.exit(2);
  }

  const outDirAbs = resolve(cwd, outDir);
  mkdirSync(outDirAbs, { recursive: true });

  const originalLock = readFileSync(lockPath, "utf8");
  const originalPkg = readFileSync(pkgPath, "utf8");

  const results: CheckResult[] = [];

  const check = (id: string, label: string, path: string, original: string): CheckResult => {
    const current = readFileSync(path, "utf8");
    if (current === original) return { id, label, ok: true };
    const diff = unifiedDiff(id, original, current) ?? "(files differ but diff was empty)";
    const snippet = diff.split("\n").slice(0, 80).join("\n");
    return { id, label, ok: false, diff, snippet };
  };

  try {
    // Step 1: bun install — must not modify bun.lock.
    if (!skipInstall) {
      console.log("→ bun install (verifying bun.lock matches package.json)");
      run("bun", ["install"]);
    }
    results.push(check("bun_lock_after_install", "bun install → bun.lock drift", lockPath, originalLock));

    // Step 2: sync overrides — must not modify package.json.
    console.log("→ scripts/sync-overrides-from-lock.ts (verifying overrides match resolved versions)");
    run("bun", ["run", "scripts/sync-overrides-from-lock.ts"]);
    results.push(check("package_json_after_overrides_sync", "overrides sync → package.json drift", pkgPath, originalPkg));

    // Step 3: bun install again — must not modify bun.lock.
    if (!skipInstall) {
      console.log("→ bun install (re-verifying bun.lock is stable after overrides sync)");
      run("bun", ["install"]);
    }
    results.push(check("bun_lock_after_reinstall", "re-install → bun.lock drift", lockPath, originalLock));
  } catch (err) {
    console.error(String(err));
    // Restore originals so we don't leave a mutated working tree behind.
    writeFileSync(lockPath, originalLock);
    writeFileSync(pkgPath, originalPkg);
    process.exit(2);
  }

  const failed = results.filter((r) => !r.ok);

  if (failed.length === 0) {
    console.log("\n✅ bun.lock and package.json are internally consistent (no drift).");
    // Restore originals in case bun install rewrote whitespace/ordering that
    // was byte-identical to the committed file (defensive).
    writeFileSync(lockPath, originalLock);
    writeFileSync(pkgPath, originalPkg);
    process.exit(0);
  }

  // Write drift artifacts for the CI upload step.
  copyFileSync(lockPath, join(outDirAbs, "bun.lock.regenerated"));
  copyFileSync(pkgPath, join(outDirAbs, "package.json.regenerated"));
  writeFileSync(join(outDirAbs, "bun.lock.committed"), originalLock);
  writeFileSync(join(outDirAbs, "package.json.committed"), originalPkg);

  for (const r of failed) {
    if (r.diff) writeFileSync(join(outDirAbs, `${r.id}.diff`), r.diff);
  }

  // Machine-readable summary consumed by the workflow's PR comment step.
  const summary = {
    ok: false,
    outDir,
    results: results.map((r) => ({
      id: r.id,
      label: r.label,
      ok: r.ok,
      snippet: r.snippet ?? null,
    })),
  };
  writeFileSync(join(outDirAbs, "summary.json"), JSON.stringify(summary, null, 2));

  console.error("\n❌ Lockfile drift detected:");
  for (const r of failed) console.error(`  - ${r.label} (${r.id})`);
  console.error(`\nDrift artifacts written to: ${outDir}/`);
  console.error("Fix: run `bun run scripts/sync-overrides-from-lock.ts && bun install` locally, commit both files, and push.");

  // Restore originals so callers can inspect without a dirty tree.
  writeFileSync(lockPath, originalLock);
  writeFileSync(pkgPath, originalPkg);
  process.exit(1);
}

main();
