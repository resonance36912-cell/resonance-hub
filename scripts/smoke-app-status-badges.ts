#!/usr/bin/env bun
/**
 * Smoke test: asserts the status badge and access wording rendered
 * server-side match each app's registry status.
 *
 *   1. /apps renders the status legend with all four statuses.
 *   2. /apps/$appKey renders the expected badge label, the access line
 *      ("Live access" / "Beta badge, live access" / …) and the explanation
 *      sentence for that app's registry status — and does NOT render the
 *      wording of a contradicting status.
 *
 * Runs against BASE_URL (default http://localhost:8080). Exits non-zero on
 * any mismatch so it can gate CI.
 */

import { APP_REGISTRY, ECOSYSTEM_REGISTRY } from "../src/lib/app-registry";
import { APP_STATUS_LEGEND, APP_STATUS_MEANING } from "../src/lib/app-status-meaning";

const BASE = process.env.BASE_URL ?? "http://localhost:8080";

const failures: string[] = [];
let passes = 0;

function pass(name: string) {
  passes += 1;
  console.log(`✓ ${name}`);
}
function fail(name: string, detail: string) {
  failures.push(`${name} — ${detail}`);
  console.log(`✗ ${name} — ${detail}`);
}

/** SSR HTML can carry NUL bytes from the inlined module payload. */
async function get(path: string): Promise<{ status: number; text: string }> {
  const res = await fetch(new URL(path, BASE).toString(), { redirect: "follow" });
  const text = (await res.text()).replace(/\0/g, "");
  return { status: res.status, text };
}

/** Strip tags/entities so copy split across elements still matches. */
function visibleText(html: string): string {
  const body = html.replace(/<script[\s\S]*?<\/script>/g, " ");
  return body
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#x27;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function checkLegend() {
  const { status, text } = await get("/apps");
  if (status !== 200) return fail("/apps responds 200", `got ${status}`);
  const visible = visibleText(text);
  if (!visible.includes("What the status badges mean")) {
    return fail("/apps renders status legend", "heading missing from SSR HTML");
  }
  for (const s of APP_STATUS_LEGEND) {
    const m = APP_STATUS_MEANING[s];
    if (!visible.includes(m.access)) {
      fail(`/apps legend explains "${s}"`, `missing access line "${m.access}"`);
      continue;
    }
    pass(`/apps legend explains "${s}" (${m.access})`);
  }
}

async function checkAppPage(key: string, label: string, statusKey: keyof typeof APP_STATUS_MEANING) {
  const { status, text } = await get(`/apps/${key}`);
  if (status !== 200) return fail(`/apps/${key} responds 200`, `got ${status}`);
  const visible = visibleText(text);
  const meaning = APP_STATUS_MEANING[statusKey];

  if (!visible.includes(`${meaning.label} — ${meaning.access}`)) {
    fail(`/apps/${key} badge matches registry`, `expected "${meaning.label} — ${meaning.access}"`);
  } else {
    pass(`/apps/${key} (${label}) badge: ${meaning.label} — ${meaning.access}`);
  }

  if (!visible.includes(meaning.explanation.slice(0, 40))) {
    fail(`/apps/${key} renders explanation`, `expected "${meaning.explanation.slice(0, 40)}…"`);
  } else {
    pass(`/apps/${key} renders the ${statusKey} explanation`);
  }

  // No contradicting status wording on the page.
  for (const other of APP_STATUS_LEGEND) {
    if (other === statusKey) continue;
    const otherAccess = APP_STATUS_MEANING[other].access;
    if (otherAccess === meaning.access) continue;
    if (visible.includes(`${APP_STATUS_MEANING[other].label} — ${otherAccess}`)) {
      fail(`/apps/${key} shows only its own status`, `also rendered "${other}" wording`);
    }
  }
}

async function main() {
  console.log(`smoke-app-status-badges → ${BASE}\n`);
  await checkLegend();
  for (const entry of Object.values(APP_REGISTRY)) {
    await checkAppPage(entry.key, entry.label, entry.status);
  }
  // Ecosystem entries have no detail route today; assert their status is at
  // least representable so the legend stays complete.
  for (const entry of Object.values(ECOSYSTEM_REGISTRY)) {
    if (!APP_STATUS_MEANING[entry.status]) {
      fail(`ecosystem ${entry.key} status is explainable`, `unknown status "${entry.status}"`);
    } else {
      pass(`ecosystem ${entry.key} status "${entry.status}" has badge copy`);
    }
  }

  console.log(`\n${passes} passed, ${failures.length} failed`);
  if (failures.length) {
    console.error("\nFailures:");
    for (const f of failures) console.error(`  • ${f}`);
    process.exit(1);
  }
  console.log("✅ every status badge matches the registry");
}

await main();
