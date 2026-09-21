#!/usr/bin/env bun
import { execFileSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();

const TRACKED_GENERATED = ["reports/discernment-violations.json", "src/routeTree.gen.ts"] as const;

const UNTRACKED_GENERATED = [
  "src/routes/[.mcp]",
  "src/routes/[.well-known]",
  "src/routes/mcp.ts",
  "sbom-cyclonedx.json",
  "sbom-spdx.json",
  "results.sarif",
] as const;

const PRESERVED_CI_ARTIFACTS = [
  "reports/junit.xml",
  "reports/coverage",
] as const;

function statusEntries(): Array<{ status: string; path: string }> {
  const raw = execFileSync("git", ["status", "--porcelain=v1", "-z", "--untracked-files=all"], {
    cwd: root,
    encoding: "utf8",
  });
  if (!raw) return [];
  return raw
    .split("\0")
    .filter(Boolean)
    .map((entry) => ({
      status: entry.slice(0, 2),
      path: entry.slice(3),
    }));
}

function matchesPath(path: string, candidates: readonly string[]): boolean {
  return candidates.some(
    (candidate) => path === candidate || path.startsWith(`${candidate}/`),
  );
}

function isAllowed(path: string): boolean {
  if ((TRACKED_GENERATED as readonly string[]).includes(path)) return true;
  if (matchesPath(path, UNTRACKED_GENERATED)) return true;
  return matchesPath(path, PRESERVED_CI_ARTIFACTS);
}

const before = statusEntries();
const unexpected = before.filter((entry) => !isAllowed(entry.path));

if (unexpected.length > 0) {
  console.error("Unexpected build-time working-tree changes:");
  for (const entry of unexpected) {
    console.error(`  ${entry.status} ${entry.path}`);
  }
  process.exit(1);
}

const trackedDirty = before
  .filter((entry) => (TRACKED_GENERATED as readonly string[]).includes(entry.path))
  .map((entry) => entry.path);

if (trackedDirty.length > 0) {
  execFileSync("git", ["restore", "--worktree", "--", ...trackedDirty], {
    cwd: root,
    stdio: "inherit",
  });
}

for (const path of UNTRACKED_GENERATED) {
  const fullPath = resolve(root, path);
  if (existsSync(fullPath)) rmSync(fullPath, { recursive: true, force: true });
}

const after = statusEntries();
const remainingUnexpected = after.filter(
  (entry) => !matchesPath(entry.path, PRESERVED_CI_ARTIFACTS),
);
if (remainingUnexpected.length > 0) {
  console.error("Generated artifact normalization left unexpected working-tree changes:");
  for (const entry of remainingUnexpected) {
    console.error(`  ${entry.status} ${entry.path}`);
  }
  process.exit(1);
}

console.log(
  "✓ Generated MCP/TanStack/discernment artifacts normalized; only preserved CI report artifacts may remain.",
);
