/**
 * Unit tests for the published-feed status parity checker.
 *
 * Run: bun test scripts/lib/published-feed-parity.test.ts
 */
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { APP_REGISTRY, ECOSYSTEM_REGISTRY } from "../../src/lib/app-registry";
import { APP_STATUS_MEANING } from "../../src/lib/app-status-meaning";
import type { RegistryFacts } from "./registry-status-parity";
import {
  LABEL_TONE,
  allowedFeedLabels,
  checkBadgeVocabulary,
  checkPublishedFeed,
  parsePublishedFeed,
} from "./published-feed-parity";

const ROOT = join(import.meta.dir, "..", "..");
const FEED = join(ROOT, "public", "content", "updates.json");

const registry: RegistryFacts[] = [
  ...Object.values(APP_REGISTRY)
    .filter((a) => a.key !== "all_access")
    .map((a) => ({ key: a.key, label: a.label, url: a.url, status: a.status })),
  ...Object.values(ECOSYSTEM_REGISTRY).map((e) => ({
    key: e.key,
    label: e.label,
    url: e.url,
    status: e.status,
  })),
];

describe("real published feed", () => {
  const { rows, violations } = parsePublishedFeed(readFileSync(FEED, "utf8"));

  it("parses with no malformed rows", () => {
    expect(violations).toEqual([]);
    expect(rows.length).toBeGreaterThan(0);
  });

  it("has zero label/tone violations against the live registry", () => {
    const result = checkPublishedFeed({ registry, rows });
    expect(result.violations).toEqual([]);
  });

  it("matches at least the four paid spokes to registry entries", () => {
    const result = checkPublishedFeed({ registry, rows });
    expect(result.checked).toBeGreaterThanOrEqual(4);
  });

  it("labels Sync Vision consistently with its live registry status", () => {
    const row = rows.find((r) => r.app.toLowerCase().includes("sync vision"));
    expect(row).toBeDefined();
    expect(APP_REGISTRY.sync_vision.status).toBe("live");
    expect(["Live", "New", "Updating"]).toContain(row!.status);
  });
});

describe("badge vocabulary", () => {
  it("every registry status badge label is an accepted feed label", () => {
    expect(checkBadgeVocabulary()).toEqual([]);
  });

  it("each badge label maps to a tone", () => {
    for (const meaning of Object.values(APP_STATUS_MEANING)) {
      expect(LABEL_TONE[meaning.label]).toBeDefined();
    }
  });

  it("exposes the accepted label list", () => {
    expect(allowedFeedLabels()).toContain("Live");
    expect(allowedFeedLabels()).toContain("Coming soon");
  });
});

describe("synthetic drift is caught", () => {
  const rowsOf = (r: { app: string; status: string; tone: string }[]) =>
    r.map((x, index) => ({ ...x, index }));

  it("flags a coming_soon app advertised as Live", () => {
    const reg: RegistryFacts[] = [
      { key: "ghost", label: "Ghost App", url: "https://ghost.example", status: "coming_soon" },
    ];
    const result = checkPublishedFeed({
      registry: reg,
      rows: rowsOf([{ app: "Ghost App", status: "Live", tone: "live" }]),
    });
    expect(result.violations.some((v) => v.kind === "status_contradiction")).toBe(true);
  });

  it("flags a tone that contradicts its own label", () => {
    const result = checkPublishedFeed({
      registry,
      rows: rowsOf([{ app: "Sync Vision", status: "Live", tone: "soon" }]),
    });
    expect(result.violations.some((v) => v.kind === "tone_mismatch")).toBe(true);
  });

  it("flags an invented label", () => {
    const result = checkPublishedFeed({
      registry,
      rows: rowsOf([{ app: "Sync Vision", status: "Totally Shipped", tone: "live" }]),
    });
    expect(result.violations.some((v) => v.kind === "unknown_label")).toBe(true);
  });

  it("accepts a pilot app labelled Free Pilot", () => {
    const result = checkPublishedFeed({
      registry,
      rows: rowsOf([{ app: "Career Compass", status: "Free Pilot", tone: "pilot" }]),
    });
    expect(result.violations).toEqual([]);
  });

  it("reports unmatched rows instead of failing them", () => {
    const result = checkPublishedFeed({
      registry,
      rows: rowsOf([{ app: "Reson8 Governance", status: "New", tone: "new" }]),
    });
    expect(result.violations).toEqual([]);
    expect(result.unmatched).toContain("Reson8 Governance");
  });

  it("rejects malformed JSON and non-array payloads", () => {
    expect(parsePublishedFeed("{oops").violations[0]!.kind).toBe("malformed_row");
    expect(parsePublishedFeed('{"a":1}').violations[0]!.message).toContain("must be an array");
    expect(parsePublishedFeed('[{"app":"X"}]').violations[0]!.kind).toBe("malformed_row");
  });
});
