/**
 * Shared pin-audit core.
 *
 * One source of truth for "which dependency is wrong, and what does bun.lock
 * actually resolve it to?" — used by both `scripts/verify-pinned-deps.ts`
 * (the checker) and `scripts/verify-deps-pinned.ts` (the prebuild wrapper that
 * prints the remediation block), so the two can never disagree about the
 * offenders they report.
 */
import { readFileSync } from "node:fs";

export type Deps = Record<string, string>;

/** Why a dependency failed the audit. */
export type PinIssueKind =
  /** package.json uses a range (^, ~, >=, *, latest, "a - b", "a || b"). */
  | "range"
  /** package.json names a version bun.lock has no entry for. */
  | "missing"
  /** Exact pin, but bun.lock resolved a different version. */
  | "mismatch";

export type PinIssue = {
  kind: PinIssueKind;
  /** "dependencies", "devDependencies", "overrides", "pnpm.overrides". */
  section: string;
  name: string;
  /** The spec as written in package.json. */
  spec: string;
  /** Version bun.lock resolves, or null when absent from the lockfile. */
  resolved: string | null;
};

/** Range-ish specs: leading operator, hyphen range, or `||` union. */
const RANGE = /^[\^~><=]|(?:\s-\s)|\|\|/;

/** Non-registry specs we cannot pin to a semver version. */
const EXEMPT_PROTO = /^(?:workspace:|link:|file:|github:|git\+|https?:|npm:|catalog:)/;

export function isRangeSpec(spec: string): boolean {
  return RANGE.test(spec) || spec === "*" || spec === "latest";
}

export function isExemptSpec(spec: string): boolean {
  return EXEMPT_PROTO.test(spec);
}

/**
 * bun.lock is JSONC (comments + trailing commas). Parsed via `Function`
 * because the file is trusted local project state, not untrusted input.
 */
export function parseLock(lockText: string): { packages?: Record<string, unknown> } {
  return new Function(`return (${lockText})`)() as { packages?: Record<string, unknown> };
}

/**
 * bun.lock v1 shape: `{ packages: { "name": ["name@version", ...] | {...} } }`.
 * Scoped names contain an `@` themselves, so split on the LAST one.
 */
export function resolvedVersion(
  lockPkgs: Record<string, unknown>,
  name: string,
): string | null {
  const entry = lockPkgs[name];
  if (!entry) return null;
  const key = Array.isArray(entry)
    ? entry[0]
    : ((entry as Record<string, unknown>)["key"] ?? (entry as Record<string, unknown>)[0]);
  if (typeof key !== "string") return null;
  const at = key.lastIndexOf("@");
  return at > 0 ? key.slice(at + 1) : null;
}

export type PinAuditInput = {
  pkg: {
    dependencies?: Deps;
    devDependencies?: Deps;
    overrides?: Deps;
    pnpm?: { overrides?: Deps };
  };
  lockPkgs: Record<string, unknown>;
};

/**
 * Audits every version-bearing section of package.json against bun.lock.
 *
 * `overrides` / `pnpm.overrides` are checked for exactness only: they may name
 * transitive packages that have no top-level bun.lock entry, so a missing
 * lockfile row there is not an error. A range there still is.
 */
export function collectPinIssues({ pkg, lockPkgs }: PinAuditInput): PinIssue[] {
  const issues: PinIssue[] = [];

  const sections: Array<{ section: string; deps: Deps | undefined; crossCheck: boolean }> = [
    { section: "dependencies", deps: pkg.dependencies, crossCheck: true },
    { section: "devDependencies", deps: pkg.devDependencies, crossCheck: true },
    { section: "overrides", deps: pkg.overrides, crossCheck: false },
    { section: "pnpm.overrides", deps: pkg.pnpm?.overrides, crossCheck: false },
  ];

  for (const { section, deps, crossCheck } of sections) {
    if (!deps) continue;
    for (const [name, spec] of Object.entries(deps)) {
      if (isExemptSpec(spec)) continue;
      const resolved = resolvedVersion(lockPkgs, name);

      if (isRangeSpec(spec)) {
        // Report the range and, when the lockfile knows the package, the exact
        // version to paste in its place.
        issues.push({ kind: "range", section, name, spec, resolved });
        continue;
      }
      if (!crossCheck) continue;
      if (resolved === null) {
        issues.push({ kind: "missing", section, name, spec, resolved: null });
        continue;
      }
      if (resolved !== spec) {
        issues.push({ kind: "mismatch", section, name, spec, resolved });
      }
    }
  }

  return issues;
}

/** Reads package.json + bun.lock from disk and audits them. */
export function auditPinsFromDisk(cwd = process.cwd()): PinIssue[] {
  const pkg = JSON.parse(readFileSync(`${cwd}/package.json`, "utf8"));
  const lock = parseLock(readFileSync(`${cwd}/bun.lock`, "utf8"));
  return collectPinIssues({ pkg, lockPkgs: lock.packages ?? {} });
}

/** One-line human explanation naming the offender and the expected version. */
export function describeIssue(issue: PinIssue): string {
  const id = `${issue.section}.${issue.name}`;
  switch (issue.kind) {
    case "range":
      return issue.resolved
        ? `${id}: "${issue.spec}" is a range — pin it to "${issue.resolved}" (the version bun.lock resolves)`
        : `${id}: "${issue.spec}" is a range and bun.lock has no entry for it — run \`bun install\`, then pin to the resolved version`;
    case "missing":
      return `${id}: "${issue.spec}" is not present in bun.lock — run \`bun install\` and commit bun.lock`;
    case "mismatch":
      return `${id}: package.json says "${issue.spec}" but bun.lock resolves "${issue.resolved}" — change package.json to "${issue.resolved}", or run \`bun install\` to move the lockfile`;
  }
}

/** Fixed-width table of offenders: what's declared vs what the lockfile has. */
export function formatIssueTable(issues: PinIssue[]): string {
  const rows = issues.map((i) => ({
    dep: `${i.section}.${i.name}`,
    declared: i.spec,
    lock: i.resolved ?? "(absent)",
    fix: i.kind === "missing" ? "bun install" : `pin to ${i.resolved ?? "resolved version"}`,
  }));

  const headers = { dep: "DEPENDENCY", declared: "PACKAGE.JSON", lock: "BUN.LOCK", fix: "FIX" };
  const width = (key: keyof typeof headers) =>
    Math.max(headers[key].length, ...rows.map((r) => r[key].length));
  const w = {
    dep: width("dep"),
    declared: width("declared"),
    lock: width("lock"),
    fix: width("fix"),
  };
  const line = (r: Record<keyof typeof headers, string>) =>
    `  ${r.dep.padEnd(w.dep)}  ${r.declared.padEnd(w.declared)}  ${r.lock.padEnd(w.lock)}  ${r.fix}`;

  return [
    line(headers),
    `  ${"─".repeat(w.dep)}  ${"─".repeat(w.declared)}  ${"─".repeat(w.lock)}  ${"─".repeat(w.fix)}`,
    ...rows.map(line),
  ].join("\n");
}
