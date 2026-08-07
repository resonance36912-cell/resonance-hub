/**
 * Scheduled drift check for the app-status health endpoint.
 *
 * Fetches /api/public/app-status/health, reduces it to the watched fields
 * (status, badge label, access line, accessibility, legend wording), and
 * compares it against the committed baseline in baselines/app-status.json.
 *
 * Usage:
 *   bun run scripts/check-app-status-drift.ts                # check
 *   bun run scripts/check-app-status-drift.ts --update       # promote baseline
 *   BASE_URL=https://reson8.life bun run scripts/check-app-status-drift.ts
 *
 * Exit codes: 0 = no drift, 1 = drift or unreachable endpoint.
 * Side effects: writes a GitHub job summary and drift-alert.md when running in
 * CI so the workflow can forward the body to Slack / email.
 */
import { existsSync, readFileSync, writeFileSync, appendFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  diffBaselines,
  extractBaseline,
  formatDriftMarkdown,
  summarizeDrift,
  type StatusBaseline,
} from "./lib/app-status-drift";

const HEALTH_PATH = "/api/public/app-status/health";
const BASE_URL = (process.env["BASE_URL"] ?? "https://reson8.life").replace(/\/+$/, "");
const BASELINE_PATH = resolve(process.cwd(), "baselines/app-status.json");
const ALERT_PATH = resolve(process.cwd(), "drift-artifacts/app-status-alert.md");
const UPDATE = process.argv.includes("--update");

function writeFileEnsured(path: string, contents: string) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
}

function publish(title: string, body: string) {
  const summary = process.env["GITHUB_STEP_SUMMARY"];
  if (summary) appendFileSync(summary, `## ${title}\n\n${body}\n`);
  const output = process.env["GITHUB_OUTPUT"];
  if (output) appendFileSync(output, `summary_line=${title.replace(/\n/g, " ")}\n`);
  writeFileEnsured(ALERT_PATH, `${title}\n\n${body}\n`);
}

async function main(): Promise<number> {
  const url = `${BASE_URL}${HEALTH_PATH}`;
  let payload: unknown;
  try {
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    payload = await res.json();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const title = `App status health endpoint unreachable (${url})`;
    console.error(`✗ ${title}: ${message}`);
    publish(title, `The scheduled check could not read \`${url}\`: ${message}`);
    return 1;
  }

  const { baseline: live, errors } = extractBaseline(payload);

  if (UPDATE || !existsSync(BASELINE_PATH)) {
    writeFileEnsured(BASELINE_PATH, `${JSON.stringify(live, null, 2)}\n`);
    console.log(
      `${UPDATE ? "Promoted" : "Created"} baseline: ${live.apps.length} apps, ` +
        `${live.ecosystem.length} ecosystem entries, ${live.legend.length} legend rows (${url})`,
    );
    if (errors.length) {
      for (const e of errors) console.error(`✗ ${e}`);
      return 1;
    }
    return 0;
  }

  const baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8")) as StatusBaseline;
  const report = diffBaselines(baseline, live, errors);
  const title = summarizeDrift(report, url);
  const body = formatDriftMarkdown(report, url);

  if (report.clean) {
    console.log(`✓ ${title} — ${live.apps.length} apps, ${live.ecosystem.length} ecosystem`);
    publish(title, body);
    return 0;
  }

  console.error(body);
  publish(title, body);
  return 1;
}

process.exit(await main());
