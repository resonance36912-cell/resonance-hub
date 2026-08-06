#!/usr/bin/env bun
/**
 * Smoke test: asserts the SSR'd OpenGraph/Twitter tags on every
 * /apps/$appKey page reflect that app's registry status meaning, and that
 * no contradicting status wording leaks into a link preview.
 *
 * Runs against BASE_URL (default http://localhost:8080).
 */

import { APP_REGISTRY, type AppRegistryEntry } from "../src/lib/app-registry";
import { APP_STATUS_MEANING, statusMeaning } from "../src/lib/app-status-meaning";
import {
  appDetailMeta,
  appDetailUrl,
  type HeadMetaTag,
} from "../src/lib/app-status-meta";

const BASE = process.env.BASE_URL ?? "http://localhost:8080";

const failures: string[] = [];
let passes = 0;
const pass = (n: string) => { passes += 1; console.log(`✓ ${n}`); };
const fail = (n: string, d: string) => { failures.push(`${n} — ${d}`); console.log(`✗ ${n} — ${d}`); };

function decode(v: string): string {
  return v
    .replace(/&amp;/g, "&")
    .replace(/&#x27;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&#x2F;/g, "/")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ");
}

/** Parse <meta> tags (any attribute order) plus <title> out of SSR HTML. */
function parseHead(html: string): { metas: Map<string, string>; title?: string; canonical?: string } {
  const clean = html.replace(/\0/g, "");
  const metas = new Map<string, string>();
  for (const m of clean.matchAll(/<meta\b[^>]*>/g)) {
    const tag = m[0];
    const key = /(?:name|property)="([^"]+)"/.exec(tag)?.[1];
    const content = /content="([^"]*)"/.exec(tag)?.[1];
    if (key && content !== undefined) metas.set(key, decode(content));
  }
  const title = /<title[^>]*>([\s\S]*?)<\/title>/.exec(clean)?.[1];
  const canonical = /<link\b[^>]*rel="canonical"[^>]*>/.exec(clean)?.[0];
  const href = canonical ? /href="([^"]*)"/.exec(canonical)?.[1] : undefined;
  return { metas, title: title ? decode(title).trim() : undefined, canonical: href ? decode(href) : undefined };
}

function expected(entry: AppRegistryEntry): Map<string, string> {
  const map = new Map<string, string>();
  for (const t of appDetailMeta(entry) as HeadMetaTag[]) {
    if ("title" in t) continue;
    map.set("name" in t ? t.name : t.property, t.content);
  }
  return map;
}

async function checkApp(entry: AppRegistryEntry) {
  const path = `/apps/${entry.key}`;
  const res = await fetch(new URL(path, BASE).toString(), { redirect: "follow" });
  if (res.status !== 200) return fail(`${path} responds 200`, `got ${res.status}`);
  const html = await res.text();
  const head = parseHead(html);
  const meaning = statusMeaning(entry.status);

  if (head.title !== `${entry.label} — Resonance Apps`) {
    fail(`${path} title`, `got ${JSON.stringify(head.title)}`);
  } else pass(`${path} title`);

  for (const [key, value] of expected(entry)) {
    const actual = head.metas.get(key);
    if (actual !== value) {
      fail(`${path} ${key}`, `expected ${JSON.stringify(value)}, got ${JSON.stringify(actual)}`);
    } else pass(`${path} ${key}`);
  }

  if (head.canonical !== appDetailUrl(entry.key)) {
    fail(`${path} canonical`, `got ${JSON.stringify(head.canonical)}`);
  } else pass(`${path} canonical`);

  // No contradicting status wording in any social tag.
  const social = ["og:title", "og:description", "twitter:title", "twitter:description", "description"]
    .map((k) => head.metas.get(k) ?? "")
    .join(" | ");
  let leaked = false;
  for (const [status, other] of Object.entries(APP_STATUS_MEANING)) {
    if (status === entry.status) continue;
    if (social.includes(other.access) || social.includes(other.explanation)) {
      leaked = true;
      fail(`${path} no ${status} wording leak`, "contradicting status copy found in meta tags");
    }
  }
  if (!leaked) pass(`${path} social tags agree with ${meaning.label} badge`);
}

const apps = Object.values(APP_REGISTRY) as AppRegistryEntry[];
for (const entry of apps) await checkApp(entry);

console.log(`\n${passes} passed, ${failures.length} failed`);
if (failures.length) {
  console.error("\nFailures:\n" + failures.map((f) => ` - ${f}`).join("\n"));
  process.exit(1);
}
