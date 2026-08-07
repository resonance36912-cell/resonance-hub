#!/usr/bin/env bun
/**
 * Live JSON-LD schema validation step for the /apps/<unknown> not-found page.
 *
 * Runs the same schema.org validator the unit tests use, but against the JSON-LD
 * the running app actually serves. Strict mode is on: any property outside the
 * documented ItemList / ListItem / SoftwareApplication spec fails the run, so a
 * stray key added to the payload can never reach crawlers unnoticed.
 *
 * Usage:  bun run scripts/verify-not-found-jsonld-live.ts
 *         BASE_URL=https://reson8.life bun run scripts/verify-not-found-jsonld-live.ts
 */
import { formatIssues, validateItemList } from "./lib/schema-org-validate";

const BASE = process.env["BASE_URL"] ?? "http://localhost:8080";

/** Slugs that must produce fuzzy matches, and therefore an ItemList. */
const MATCH_SLUGS = [
  "sinc-vision",
  "sync-vison",
  "creativ-studio",
  "epublishr",
  "yt-optimizer",
  "youtube",
  "resonance",
];

/** Slugs with no plausible match: the page must emit no ItemList at all. */
const NO_MATCH_SLUGS = ["zzzzzzzzzzzz", "qqqqqqqqqq", "1234567890"];

const LD_RE =
  /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi;

function unescapeHtml(input: string): string {
  return input
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function ldBlocks(html: string): string[] {
  return [...html.matchAll(LD_RE)].map((m) => unescapeHtml((m[1] ?? "").trim()));
}

let checks = 0;
const failures: string[] = [];

function check(name: string, ok: boolean, detail = ""): void {
  checks += 1;
  if (ok) {
    console.log(`✓ ${name}${detail ? ` (${detail})` : ""}`);
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function fetchHtml(path: string): Promise<{ status: number; html: string }> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "User-Agent": "not-found-jsonld-verify" },
  });
  return { status: res.status, html: await res.text() };
}

async function main(): Promise<void> {
  console.log(`Validating not-found JSON-LD against ${BASE}\n`);

  for (const slug of MATCH_SLUGS) {
    const path = `/apps/${slug}`;
    const { status, html } = await fetchHtml(path);
    check(`[${slug}] page served`, status === 200 || status === 404, `status=${status}`);

    const blocks = ldBlocks(html);
    check(`[${slug}] exactly one ld+json block`, blocks.length === 1, `count=${blocks.length}`);

    blocks.forEach((raw, index) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch (error) {
        check(`[${slug}] block ${index} is valid JSON`, false, String(error));
        return;
      }
      check(`[${slug}] block ${index} is valid JSON`, true);

      const nodes = Array.isArray(parsed) ? parsed : [parsed];
      for (const node of nodes) {
        const atType = (node as Record<string, unknown> | null)?.["@type"];
        check(
          `[${slug}] block ${index} @type is ItemList`,
          atType === "ItemList",
          String(atType),
        );
        if (atType !== "ItemList") continue;

        const issues = validateItemList(node, { strict: true });
        check(
          `[${slug}] block ${index} is schema-valid (strict)`,
          issues.length === 0,
          issues.length ? `\n${formatIssues(issues)}` : "no issues",
        );

        const unexpected = issues.filter((i) => i.message.startsWith("unexpected property"));
        check(
          `[${slug}] block ${index} has no unexpected properties`,
          unexpected.length === 0,
          unexpected.map((i) => i.path).join(", "),
        );
      }
    });
  }

  for (const slug of NO_MATCH_SLUGS) {
    const path = `/apps/${slug}`;
    const { status, html } = await fetchHtml(path);
    check(`[${slug}] page served`, status === 200 || status === 404, `status=${status}`);

    const blocks = ldBlocks(html);
    check(`[${slug}] emits no ld+json when there are no matches`, blocks.length === 0,
      `count=${blocks.length}`);

    // If a block ever appears here, it must still be schema-valid rather than a
    // half-built ItemList with zero elements.
    for (const [index, raw] of blocks.entries()) {
      try {
        const issues = validateItemList(JSON.parse(raw), { strict: true });
        check(`[${slug}] unexpected block ${index} is at least schema-valid`,
          issues.length === 0, formatIssues(issues));
      } catch (error) {
        check(`[${slug}] unexpected block ${index} parses`, false, String(error));
      }
    }
  }

  console.log(`\n${checks - failures.length}/${checks} checks passed`);
  if (failures.length > 0) {
    console.error("\nFailures:");
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exit(1);
  }
}

await main();
