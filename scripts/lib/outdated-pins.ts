/**
 * Outdated-pin audit core (pure, no network, no writes).
 *
 * Every dependency in this repo is pinned to an EXACT version (enforced by
 * scripts/verify-deps-pinned.ts). That guarantees reproducible builds but means
 * nothing ever moves on its own — so we need a *reporting* pass that says
 * "these pins are behind, here is the exact diff to apply", without touching
 * package.json or bun.lock.
 *
 * This module holds the comparison + rendering logic so it can be unit-tested
 * without hitting the npm registry. The network fetch and file writes live in
 * scripts/check-outdated-pins.ts.
 */
import { isExemptSpec, isRangeSpec } from "./pinned-deps";

/** Sections we report on. `overrides` are deliberately excluded: they pin
 *  transitive packages to satisfy advisories, so "newer exists" is not
 *  actionable there without re-checking the advisory. */
export const REPORTED_SECTIONS = ["dependencies", "devDependencies"] as const;
export type ReportedSection = (typeof REPORTED_SECTIONS)[number];

export type PinnedDep = { section: ReportedSection; name: string; current: string };

export type Bump = "patch" | "minor" | "major" | "prerelease";

export type OutdatedDep = PinnedDep & {
  /** Latest version on the `latest` dist-tag. */
  latest: string;
  bump: Bump;
};

/** A dependency we could not evaluate (registry error, unparseable version). */
export type SkippedDep = PinnedDep & { reason: string };

export type OutdatedReport = {
  generatedAt: string;
  total: number;
  outdated: OutdatedDep[];
  skipped: SkippedDep[];
};

export type Semver = { major: number; minor: number; patch: number; pre: string | null };

const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:[-+](.+))?$/;

export function parseSemver(v: string): Semver | null {
  const m = SEMVER.exec(v.trim());
  if (!m) return null;
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    pre: m[4] ?? null,
  };
}

/** -1 / 0 / 1. Prerelease versions sort BELOW their release (semver rule). */
export function compareSemver(a: Semver, b: Semver): number {
  for (const k of ["major", "minor", "patch"] as const) {
    if (a[k] !== b[k]) return a[k] < b[k] ? -1 : 1;
  }
  if (a.pre === b.pre) return 0;
  if (a.pre === null) return 1;
  if (b.pre === null) return -1;
  return a.pre < b.pre ? -1 : 1;
}

/** Which kind of bump moving `from` → `to` represents. */
export function classifyBump(from: Semver, to: Semver): Bump {
  if (to.major !== from.major) return "major";
  if (to.minor !== from.minor) return "minor";
  if (to.patch !== from.patch) return "patch";
  return "prerelease";
}

/**
 * Reads the exact pins we can compare. Ranges are skipped here rather than
 * flagged — verify-deps-pinned.ts owns that failure, and duplicating it would
 * mean two places disagree about what "unpinned" means.
 */
export function collectPins(pkg: Record<string, unknown>): PinnedDep[] {
  const out: PinnedDep[] = [];
  for (const section of REPORTED_SECTIONS) {
    const deps = (pkg[section] ?? {}) as Record<string, string>;
    for (const [name, spec] of Object.entries(deps)) {
      if (isExemptSpec(spec) || isRangeSpec(spec)) continue;
      out.push({ section, name, current: spec });
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** Compares one pin against the registry's `latest`. */
export function evaluatePin(
  dep: PinnedDep,
  latest: string | null,
): { outdated?: OutdatedDep; skipped?: SkippedDep } {
  if (!latest) {
    return { skipped: { ...dep, reason: "no latest version returned by the registry" } };
  }
  const cur = parseSemver(dep.current);
  const next = parseSemver(latest);
  if (!cur) return { skipped: { ...dep, reason: `pinned version "${dep.current}" is not semver` } };
  if (!next) return { skipped: { ...dep, reason: `registry latest "${latest}" is not semver` } };
  if (compareSemver(next, cur) <= 0) return {};
  return { outdated: { ...dep, latest, bump: classifyBump(cur, next) } };
}

const BUMP_ORDER: Record<Bump, number> = { major: 0, minor: 1, patch: 2, prerelease: 3 };

export function sortOutdated(deps: OutdatedDep[]): OutdatedDep[] {
  return [...deps].sort(
    (a, b) => BUMP_ORDER[a.bump] - BUMP_ORDER[b.bump] || a.name.localeCompare(b.name),
  );
}

export function countByBump(deps: OutdatedDep[]): Record<Bump, number> {
  const counts: Record<Bump, number> = { major: 0, minor: 0, patch: 0, prerelease: 0 };
  for (const d of deps) counts[d.bump] += 1;
  return counts;
}

/**
 * Stable identity of a report's *findings* (not its timestamp), so a scheduled
 * run can tell "same set of outdated pins as last week" from "something new
 * appeared" and avoid re-notifying on an unchanged issue.
 */
export function reportFingerprint(report: OutdatedReport): string {
  return sortOutdated(report.outdated)
    .map((d) => `${d.section}/${d.name}@${d.current}->${d.latest}`)
    .join(";");
}

/* ------------------------------------------------------------------ *
 * Applying the plan (pure text surgery — see apply-outdated-pins.ts)  *
 * ------------------------------------------------------------------ */

/** Which offenders to take. `low-risk` is patch + minor, the batchable group. */
export type ApplyGroup = "low-risk" | "patch" | "minor" | "major" | "all";

const GROUP_BUMPS: Record<ApplyGroup, Bump[]> = {
  "low-risk": ["patch", "minor"],
  patch: ["patch"],
  minor: ["minor"],
  major: ["major"],
  all: ["patch", "minor", "major", "prerelease"],
};

export function selectForApply(
  deps: OutdatedDep[],
  opts: { group?: ApplyGroup; only?: string[] } = {},
): OutdatedDep[] {
  const bumps = GROUP_BUMPS[opts.group ?? "low-risk"];
  const only = opts.only?.length ? new Set(opts.only) : null;
  return sortOutdated(
    deps.filter((d) => bumps.includes(d.bump) && (!only || only.has(d.name))),
  );
}

export type ApplyResult = {
  text: string;
  applied: OutdatedDep[];
  /** Pins whose `"name": "current"` line was not found where expected. */
  missed: (OutdatedDep & { reason: string })[];
};

/** Locates a top-level section's body so a rewrite can't stray into another one. */
function sectionRange(text: string, section: string): { start: number; end: number } | null {
  const head = new RegExp(`"${section}"\\s*:\\s*\\{`).exec(text);
  if (!head) return null;
  let depth = 1;
  let i = head.index + head[0].length;
  for (; i < text.length && depth > 0; i += 1) {
    if (text[i] === "{") depth += 1;
    else if (text[i] === "}") depth -= 1;
  }
  return depth === 0 ? { start: head.index + head[0].length, end: i - 1 } : null;
}

/**
 * Rewrites ONLY the requested pins, in place, in the raw package.json text.
 *
 * Text surgery rather than JSON.parse + stringify on purpose: a reparse would
 * reformat and reorder the whole file, making the resulting PR diff impossible
 * to review and touching packages nobody planned to update. Each edit must match
 * the exact `"name": "<current>"` pair inside its own section, so a stale plan
 * (someone already bumped the pin) is reported as missed instead of clobbering
 * a newer version.
 */
export function applyPins(text: string, deps: OutdatedDep[]): ApplyResult {
  let out = text;
  const applied: OutdatedDep[] = [];
  const missed: (OutdatedDep & { reason: string })[] = [];

  for (const dep of sortOutdated(deps)) {
    const range = sectionRange(out, dep.section);
    if (!range) {
      missed.push({ ...dep, reason: `no "${dep.section}" section in package.json` });
      continue;
    }
    const body = out.slice(range.start, range.end);
    const entry = new RegExp(
      `("${dep.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"\\s*:\\s*")${dep.current.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(")`,
    );
    const matches = body.match(new RegExp(entry.source, "g"));
    if (!matches) {
      missed.push({
        ...dep,
        reason: `"${dep.name}": "${dep.current}" not found in ${dep.section} (already changed?)`,
      });
      continue;
    }
    if (matches.length > 1) {
      missed.push({ ...dep, reason: `"${dep.name}" appears ${matches.length}× in ${dep.section}` });
      continue;
    }
    out =
      out.slice(0, range.start) +
      body.replace(entry, `$1${dep.latest}$2`) +
      out.slice(range.end);
    applied.push(dep);
  }

  return { text: out, applied, missed };
}

/** Deterministic branch name: same plan → same branch, so reruns update one PR. */
export function branchNameFor(deps: OutdatedDep[], group: ApplyGroup): string {
  const rows = sortOutdated(deps);
  const stamp = rows.map((d) => `${d.name}@${d.latest}`).join(",");
  let hash = 0;
  for (let i = 0; i < stamp.length; i += 1) hash = (hash * 31 + stamp.charCodeAt(i)) >>> 0;
  return `deps/outdated-pins-${group}-${hash.toString(36)}`;
}

export function prTitleFor(deps: OutdatedDep[], group: ApplyGroup): string {
  const rows = sortOutdated(deps);
  if (rows.length === 1) {
    return `deps: bump ${rows[0]!.name} to ${rows[0]!.latest}`;
  }
  return `deps: update ${rows.length} pinned ${group === "major" ? "major " : ""}dependenc${rows.length === 1 ? "y" : "ies"}`;
}

/** PR body: exactly what moved, what did not, and how it was verified. */
export function renderPrBody(
  result: ApplyResult,
  opts: { group: ApplyGroup; total: number; runUrl?: string; issueUrl?: string } = {
    group: "low-risk",
    total: 0,
  },
): string {
  const parts: string[] = [
    PR_MARKER,
    "",
    `Applies the **${opts.group}** group from the scheduled outdated-pin audit.`,
    "",
    `${result.applied.length} pin(s) updated out of ${opts.total} audited. No other package.json entries were touched — each pin was rewritten in place by exact \`"name": "version"\` match.`,
    "",
    table(result.applied),
    "",
    "### Verified before opening",
    "",
    "```sh",
    "bun install",
    "bun run scripts/sync-overrides-from-lock.ts",
    "bun run scripts/verify-deps-pinned.ts",
    "bun run prebuild",
    "```",
    "",
    "`package.json` and `bun.lock` are committed together, so the frozen-lockfile step at the top of `prebuild` stays green.",
    "",
  ];

  if (result.missed.length) {
    parts.push(
      `### Skipped (${result.missed.length})`,
      "",
      ...result.missed.map((m) => `- \`${m.name}\` — ${m.reason}`),
      "",
    );
  }

  const links: string[] = [];
  if (opts.issueUrl) links.push(`[Update plan](${opts.issueUrl})`);
  if (opts.runUrl) links.push(`[Audit run](${opts.runUrl})`);
  if (links.length) parts.push("---", "", links.join(" · "), "");

  parts.push(
    `Majors are intentionally excluded from the low-risk group; each one gets its own PR after a changelog read.`,
  );
  return parts.join("\n");
}



function table(rows: OutdatedDep[]): string {
  const lines = [
    "| Dependency | Section | Pinned | Latest | Bump |",
    "| --- | --- | --- | --- | --- |",
  ];
  for (const d of rows) {
    lines.push(
      `| \`${d.name}\` | ${d.section === "devDependencies" ? "dev" : "prod"} | \`${d.current}\` | \`${d.latest}\` | ${d.bump} |`,
    );
  }
  return lines.join("\n");
}

export const ISSUE_TITLE = "Outdated pinned dependencies — update plan";
export const ISSUE_LABEL = "dependencies";
/** Marker so the workflow can find and update its own issue instead of piling up new ones. */
export const ISSUE_MARKER = "<!-- reson8:outdated-pins -->";

/**
 * The ready-to-apply update plan. Deliberately advisory: it prints the exact
 * package.json edits and the repin command, but the script never runs them —
 * a human decides which majors to take.
 */
export function renderIssueBody(report: OutdatedReport, opts: { runUrl?: string } = {}): string {
  const rows = sortOutdated(report.outdated);
  const counts = countByBump(rows);
  const parts: string[] = [ISSUE_MARKER, "", `## ${ISSUE_TITLE}`, ""];

  parts.push(
    `Checked **${report.total}** exact pins against the npm \`latest\` dist-tag on ${report.generatedAt}.`,
    "",
    `**${rows.length} outdated** — ${counts.major} major, ${counts.minor} minor, ${counts.patch} patch, ${counts.prerelease} prerelease.`,
    "",
    "Nothing in the repo was changed by this check: pins, `bun.lock`, and overrides are untouched.",
    "",
  );

  if (!rows.length) {
    parts.push("Every pin is already at the latest published version. 🎉", "");
  } else {
    parts.push(table(rows), "");

    const patchMinor = rows.filter((d) => d.bump === "patch" || d.bump === "minor");
    const major = rows.filter((d) => d.bump === "major");

    parts.push("### Ready-to-apply plan", "");
    if (patchMinor.length) {
      parts.push(
        `**1. Low-risk (patch + minor, ${patchMinor.length})** — safe to batch in one PR:`,
        "",
        "```jsonc",
        ...patchMinor.map((d) => `"${d.name}": "${d.latest}",   // was ${d.current} (${d.section})`),
        "```",
        "",
      );
    }
    if (major.length) {
      parts.push(
        `**${patchMinor.length ? 2 : 1}. Majors (${major.length})** — one PR each, read the changelog first:`,
        "",
        ...major.map(
          (d) =>
            `- [ ] \`${d.name}\` \`${d.current}\` → \`${d.latest}\` — https://www.npmjs.com/package/${d.name}?activeTab=versions`,
        ),
        "",
      );
    }
    parts.push(
      "**Then, for either group:**",
      "",
      "```sh",
      "# edit package.json pins above, then re-resolve + re-verify",
      "bun install",
      "bun run scripts/sync-overrides-from-lock.ts",
      "bun run scripts/verify-deps-pinned.ts",
      "bun run prebuild",
      "```",
      "",
      "Commit **both** `package.json` and `bun.lock` in the same commit — `prebuild` runs `bun install --frozen-lockfile` first and stops on drift.",
      "",
    );
  }

  if (report.skipped.length) {
    parts.push(
      `### Not evaluated (${report.skipped.length})`,
      "",
      ...report.skipped.map((s) => `- \`${s.name}\` (\`${s.current}\`) — ${s.reason}`),
      "",
    );
  }

  parts.push(
    "---",
    "",
    `Generated by \`scripts/check-outdated-pins.ts\`${opts.runUrl ? ` ([run](${opts.runUrl}))` : ""}. This issue is rewritten in place on each scheduled run; close it and it will reopen only when the set of outdated pins changes.`,
  );

  return parts.join("\n");
}

/** Short one-liner for the GitHub Step Summary / console. */
export function renderSummaryLine(report: OutdatedReport): string {
  const c = countByBump(report.outdated);
  return report.outdated.length
    ? `${report.outdated.length}/${report.total} pins outdated (${c.major} major, ${c.minor} minor, ${c.patch} patch)`
    : `all ${report.total} pins up to date`;
}

/**
 * Slack Incoming Webhook message body (mrkdwn `text`, not Block Kit — the repo's
 * other alerts use the raw webhook, so keep one shape).
 *
 * Deliberately short: the top few offenders plus links. The full plan lives in
 * the issue, so duplicating 70 rows into a channel would just get muted.
 */
export function renderSlackText(
  report: OutdatedReport,
  opts: {
    /** "created" | "updated" | "closed" — what happened to the plan issue. */
    action?: string;
    issueUrl?: string;
    runUrl?: string;
    /** How many offenders to list inline (default 5). */
    top?: number;
  } = {},
): string {
  const rows = sortOutdated(report.outdated);
  const top = Math.max(1, opts.top ?? 5);
  const lines: string[] = [];

  if (!rows.length) {
    lines.push(`:white_check_mark: *Outdated pins:* all ${report.total} pins are current.`);
  } else {
    const c = countByBump(rows);
    const verb = opts.action === "created" ? "opened" : opts.action === "closed" ? "closed" : "updated";
    lines.push(
      `:package: *Outdated pinned dependencies* — plan issue ${verb}.`,
      `${rows.length} of ${report.total} pins behind (${c.major} major, ${c.minor} minor, ${c.patch} patch).`,
      "",
      ...rows.slice(0, top).map((d) => `• \`${d.name}\` ${d.current} → ${d.latest} _(${d.bump})_`),
    );
    if (rows.length > top) lines.push(`• …and ${rows.length - top} more.`);
  }

  const links: string[] = [];
  if (opts.issueUrl) links.push(`<${opts.issueUrl}|Update plan>`);
  if (opts.runUrl) links.push(`<${opts.runUrl}|CI run + report artifact>`);
  if (links.length) lines.push("", links.join(" · "));

  return lines.join("\n");
}

