/**
 * Lighthouse score gate for the /apps/<unknown-slug> not-found page.
 *
 * Runs Lighthouse (through the LHCI CLI) against the not-found page, reads the
 * category scores out of the emitted LHR JSON, and fails the build when any
 * score drops below its committed floor or regresses more than the tolerance
 * below `baselines/lighthouse-not-found.json`.
 *
 * Usage:
 *   bun run scripts/verify-lighthouse-not-found.ts
 *   BASE_URL=https://... bun run scripts/verify-lighthouse-not-found.ts
 *   bun run scripts/verify-lighthouse-not-found.ts --update   # promote baseline
 *
 * Env:
 *   BASE_URL   origin to audit (default http://127.0.0.1:8080)
 *   LH_RUNS    Lighthouse runs per URL, median is asserted (default 1, CI: 3)
 *   LH_TOLERANCE  allowed drift below baseline (default 0.03)
 *   CHROME_PATH   Chrome/Chromium binary; auto-detected from Playwright locally
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import {
  checkScores,
  formatReport,
  toBaseline,
  DEFAULT_TOLERANCE,
  LIGHTHOUSE_CATEGORIES,
  type Baseline,
  type CategoryScores,
  type LighthouseCategory,
} from "./lib/lighthouse-scores";

const BASE_URL = (process.env["BASE_URL"] ?? "http://127.0.0.1:8080").replace(/\/$/, "");
const RUNS = Math.max(1, Number(process.env["LH_RUNS"] ?? 1) || 1);
const TOLERANCE = Number(process.env["LH_TOLERANCE"] ?? DEFAULT_TOLERANCE);
const UPDATE = process.argv.includes("--update");

/** Paths audited: a zero-match slug and a close-match slug (suggestion list). */
const SKIP_AUDITS = ["http-status-code", "is-crawlable"];

const PATHS = ["/apps/definitely-not-an-app-xyz", "/apps/sync-visionn"];

const OUT_DIR = join(process.cwd(), "reports", "lighthouse-not-found");
/** LHCI always writes its LHR JSON/HTML here; we drain it between runs. */
const LHCI_DIR = join(process.cwd(), ".lighthouseci");
const BASELINE_PATH = join(process.cwd(), "baselines", "lighthouse-not-found.json");

function detectChrome(): string | undefined {
  if (process.env["CHROME_PATH"]) return process.env["CHROME_PATH"];
  const root = process.env["PLAYWRIGHT_BROWSERS_PATH"];
  if (!root || !existsSync(root)) return undefined;
  for (const dir of readdirSync(root)) {
    if (!dir.startsWith("chromium")) continue;
    for (const candidate of [
      join(root, dir, "chrome-linux", "chrome"),
      join(root, dir, "chrome-linux", "headless_shell"),
    ]) {
      if (existsSync(candidate)) return candidate;
    }
  }
  return undefined;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function collect(): Record<string, CategoryScores> {
  rmSync(OUT_DIR, { recursive: true, force: true });
  rmSync(LHCI_DIR, { recursive: true, force: true });
  mkdirSync(OUT_DIR, { recursive: true });

  const chrome = detectChrome();
  const samples = new Map<string, Map<LighthouseCategory, number[]>>();

  for (const path of PATHS) {
    const url = `${BASE_URL}${path}`;
    for (let run = 1; run <= RUNS; run++) {
      const args = [
        "--bun",
        "@lhci/cli@0.14.x",
        "collect",
        `--url=${url}`,
        "--numberOfRuns=1",
        "--settings.ignoreStatusCode=true",
        // A correct 404 page necessarily fails these two SEO audits (non-2xx
        // status, noindex). Skipping them keeps the SEO score meaningful:
        // titles, descriptions, crawlable links, structured data, font sizes.
        `--settings.skipAudits=${SKIP_AUDITS.join(",")}`,
        `--settings.preset=desktop`,
        `--settings.chromeFlags=--no-sandbox --headless=new --disable-gpu`,
      ];
      const res = spawnSync("bun", ["x", ...args], {
        stdio: ["ignore", "inherit", "inherit"],
        env: { ...process.env, ...(chrome ? { CHROME_PATH: chrome } : {}) },
      });
      if (res.status !== 0) {
        console.error(`\n✗ Lighthouse collect failed for ${url} (run ${run}/${RUNS}).`);
        process.exit(1);
      }

      const lhrDir = LHCI_DIR;
      const files = readdirSync(lhrDir).filter((f) => f.startsWith("lhr-") && f.endsWith(".json"));
      const latest = files.sort().at(-1);
      if (!latest) {
        console.error(`✗ No Lighthouse report written for ${url}.`);
        process.exit(1);
      }
      const lhr = JSON.parse(readFileSync(join(lhrDir, latest), "utf8")) as {
        categories?: Record<string, { score: number | null }>;
        runtimeError?: { code: string; message: string };
      };
      if (lhr.runtimeError && lhr.runtimeError.code !== "NO_ERROR") {
        console.error(`✗ Lighthouse runtime error on ${url}: ${lhr.runtimeError.message}`);
        process.exit(1);
      }

      const perPath = samples.get(path) ?? new Map<LighthouseCategory, number[]>();
      for (const category of LIGHTHOUSE_CATEGORIES) {
        const score = lhr.categories?.[category]?.score;
        if (typeof score !== "number") continue;
        perPath.set(category, [...(perPath.get(category) ?? []), score]);
      }
      samples.set(path, perPath);
      // Keep the raw report as a CI artifact, then drain the LHCI dir so the
      // next run's "latest" file is unambiguous.
      writeFileSync(
        join(OUT_DIR, `lhr-${path.replace(/[^a-z0-9]+/gi, "-")}-run${run}.json`),
        readFileSync(join(lhrDir, latest), "utf8")
      );
      rmSync(join(lhrDir, latest), { force: true });
    }
  }

  const measured: Record<string, CategoryScores> = {};
  for (const [path, perPath] of samples) {
    const scores: CategoryScores = {};
    for (const [category, values] of perPath) scores[category] = median(values);
    measured[path] = scores;
  }
  return measured;
}

function readBaseline(): Baseline | null {
  if (!existsSync(BASELINE_PATH)) return null;
  try {
    return JSON.parse(readFileSync(BASELINE_PATH, "utf8")) as Baseline;
  } catch {
    console.error(`✗ ${BASELINE_PATH} is not valid JSON.`);
    process.exit(1);
  }
}

console.log(`Lighthouse not-found gate — ${BASE_URL} (${RUNS} run(s) per URL)`);
const measured = collect();
const baseline = UPDATE ? null : readBaseline();
const result = checkScores(measured, baseline, TOLERANCE);

console.log("");
console.log(formatReport(result));
console.log("");

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(
  join(OUT_DIR, "report.json"),
  JSON.stringify({ baseUrl: BASE_URL, tolerance: TOLERANCE, measured, rows: result.rows }, null, 2) + "\n"
);

if (UPDATE) {
  writeFileSync(
    BASELINE_PATH,
    JSON.stringify(toBaseline(measured, "promoted via verify-lighthouse-not-found --update"), null, 2) + "\n"
  );
  console.log(`✓ Baseline written to ${BASELINE_PATH}. Commit it alongside your change.`);
  process.exit(0);
}

if (!result.ok) {
  console.error("✗ Lighthouse scores regressed on the not-found page:\n");
  for (const row of result.failures) {
    const measuredText = Number.isNaN(row.measured) ? "missing" : row.measured.toFixed(2);
    console.error(
      `  ${row.url} ${row.category}: ${measuredText} < ${row.limit.toFixed(2)} ` +
        `(floor ${row.floor.toFixed(2)}${row.baseline === null ? "" : `, baseline ${row.baseline.toFixed(2)}`}) — ${row.reason}`
    );
  }
  console.error(
    "\nFix the regression, or — if the drop is intentional and justified — re-baseline with:\n" +
      "  bun run baseline:lighthouse-not-found\n"
  );
  process.exit(1);
}

console.log(`✓ ${result.rows.length} category checks within floors and baseline tolerance.`);
