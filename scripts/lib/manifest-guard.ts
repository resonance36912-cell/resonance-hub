/**
 * Manifest guard: detects unexpected mutations of package.json / bun.lock
 * caused by running tests or prebuild steps (e.g. `bunx` fetching a missing
 * dependency and rewriting the lockfile).
 */
import { createHash } from "node:crypto";

export const GUARDED_MANIFESTS = ["package.json", "bun.lock"] as const;
export type GuardedManifest = (typeof GUARDED_MANIFESTS)[number];

export type ManifestSnapshot = {
  createdAt: string;
  label?: string;
  hashes: Record<string, string | null>;
};

export type ManifestChange = {
  file: string;
  kind: "modified" | "created" | "deleted";
  before: string | null;
  after: string | null;
};

export function hashContent(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

export function buildSnapshot(
  files: Record<string, string | null>,
  label?: string,
  now: Date = new Date(),
): ManifestSnapshot {
  const hashes: Record<string, string | null> = {};
  for (const [file, content] of Object.entries(files)) {
    hashes[file] = content === null ? null : hashContent(content);
  }
  return { createdAt: now.toISOString(), ...(label ? { label } : {}), hashes };
}

export function diffSnapshots(
  before: ManifestSnapshot,
  after: ManifestSnapshot,
): ManifestChange[] {
  const files = new Set([
    ...Object.keys(before.hashes),
    ...Object.keys(after.hashes),
  ]);
  const changes: ManifestChange[] = [];
  for (const file of [...files].sort()) {
    const b = before.hashes[file] ?? null;
    const a = after.hashes[file] ?? null;
    if (b === a) continue;
    const kind: ManifestChange["kind"] =
      b === null ? "created" : a === null ? "deleted" : "modified";
    changes.push({ file, kind, before: b, after: a });
  }
  return changes;
}

export function formatChangeReport(changes: ManifestChange[]): string {
  if (changes.length === 0) return "Manifests unchanged (package.json, bun.lock).";
  const lines = [
    "Unexpected manifest mutation detected:",
    "",
    "  FILE            CHANGE     BEFORE    AFTER",
  ];
  for (const c of changes) {
    lines.push(
      `  ${c.file.padEnd(15)} ${c.kind.padEnd(10)} ${(c.before ?? "-").slice(0, 8).padEnd(9)} ${(c.after ?? "-").slice(0, 8)}`,
    );
  }
  lines.push(
    "",
    "Tests and prebuild steps must never rewrite package.json or bun.lock.",
    "Most common cause: a script invoking a package that is not a pinned dependency,",
    "so the package manager installs it on the fly and rewrites the lockfile.",
    "",
    "Remediation:",
    "  1. Add the missing tool as an exactly pinned devDependency in package.json.",
    "  2. Run `bun install` locally and commit both package.json and bun.lock.",
    "  3. Re-run `bun run verify:manifests` to confirm the guard passes.",
  );
  return lines.join("\n");
}
