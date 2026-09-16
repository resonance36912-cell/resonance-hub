/**
 * Unit tests for scripts/lib/registry-status-parity.ts.
 *
 * Covers:
 *   - hostname / product-name normalisation
 *   - extraction of homepage tiles and feed rows from source text
 *   - the real Sync Vision regression (registry beta vs "Live" labels)
 *   - compatible-but-unequal combinations that must NOT fail
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  checkStatusParity,
  extractFeed,
  extractTiles,
  hostOf,
  nameSlug,
  type RegistryFacts,
} from "./registry-status-parity";

const SRC = `
const apps: App[] = [
  {
    name: "Resonance ePublisher",
    domain: "epublisher.reson8.life",
    href: "https://epublisher.reson8.life",
    logo: logoEpublisher,
    accent: "magenta",
    status: "live",
  },
  {
    name: "Sync Vision",
    domain: "sync.reson8.life",
    href: "https://sync.reson8.life",
    logo: logoSyncVision,
    accent: "pink",
    status: "live",
  },
];

const FALLBACK_UPDATES: UpdateItem[] = [
  { app: "Reson8 Hub", status: "Live", change: "x", date: "Jun 2026" },
  { app: "Sync Vision", status: "Live", change: "y", date: "Mar 2026" },
];
`;

const registry = (status: string): RegistryFacts[] => [
  {
    key: "epublisher",
    label: "Resonance ePublisher",
    url: "https://epublisher.reson8.life",
    status: "live" as never,
  },
  {
    key: "sync_vision",
    label: "Resonance Sync Vision",
    url: "https://sync.reson8.life",
    status: status as never,
  },
];

describe("normalisation", () => {
  test("hostOf strips scheme and www", () => {
    expect(hostOf("https://sync.reson8.life")).toBe("sync.reson8.life");
    expect(hostOf("sync.reson8.life")).toBe("sync.reson8.life");
    expect(hostOf("sync.reson8.life/")).toBe("sync.reson8.life");
  });

  test("nameSlug strips branding prefixes", () => {
    expect(nameSlug("Resonance Sync Vision")).toBe("syncvision");
    expect(nameSlug("Sync Vision")).toBe("syncvision");
    expect(nameSlug("The Resonance Podcast")).toBe("podcast");
    expect(nameSlug("YouTube Optimizer")).toBe("youtubeoptimizer");
  });
});

describe("extraction", () => {
  test("parses tiles and feed rows", () => {
    expect(extractTiles(SRC)).toEqual([
      { name: "Resonance ePublisher", domain: "epublisher.reson8.life", status: "live" },
      { name: "Sync Vision", domain: "sync.reson8.life", status: "live" },
    ]);
    expect(extractFeed(SRC)).toEqual([
      { app: "Reson8 Hub", status: "Live" },
      { app: "Sync Vision", status: "Live" },
    ]);
  });

  test("returns empty arrays when the literals are absent", () => {
    expect(extractTiles("const other = [];")).toEqual([]);
    expect(extractFeed("const other = [];")).toEqual([]);
  });
});

describe("parity", () => {
  const tiles = extractTiles(SRC);
  const feed = extractFeed(SRC);

  test("flags the Sync Vision beta-vs-Live regression on both surfaces", () => {
    const r = checkStatusParity({ registry: registry("beta"), tiles, feed });
    expect(r.violations.map((v) => v.surface).sort()).toEqual([
      "homepage_tile",
      "published_feed",
    ]);
    expect(r.violations.every((v) => v.key === "sync_vision")).toBe(true);
  });

  test("passes once the registry says live", () => {
    const r = checkStatusParity({ registry: registry("live"), tiles, feed });
    expect(r.violations).toEqual([]);
    expect(r.checked).toBe(3);
  });

  test("coming_soon must not render a live tile", () => {
    const r = checkStatusParity({ registry: registry("coming_soon"), tiles, feed });
    expect(r.violations.length).toBe(2);
  });

  test("pilot tolerates a live tile with an Updating feed note", () => {
    const r = checkStatusParity({
      registry: [
        {
          key: "youtube_optimizer",
          label: "YouTube Optimizer",
          url: "https://youtube.reson8.life",
          status: "pilot" as never,
        },
      ],
      tiles: [{ name: "YouTube Optimizer", domain: "youtube.reson8.life", status: "live" }],
      feed: [{ app: "YouTube Optimizer", status: "Updating" }],
    });
    expect(r.violations).toEqual([]);
  });

  test("rows with no registry entry are reported, not failed", () => {
    const r = checkStatusParity({ registry: registry("live"), tiles, feed });
    expect(r.unmatchedFeed).toEqual(["Reson8 Hub"]);
    expect(r.unmatchedTiles).toEqual([]);
  });

  test("unknown registry status is a hard violation", () => {
    const r = checkStatusParity({ registry: registry("sunsetting"), tiles, feed });
    expect(r.violations[0].message).toContain("not a known AppStatus");
  });
});

describe("live source", () => {
  const src = readFileSync("src/routes/index.tsx", "utf8");

  test("the real homepage parses into non-empty tile and feed sets", () => {
    expect(extractTiles(src).length).toBeGreaterThan(3);
    expect(extractFeed(src).length).toBeGreaterThan(3);
  });
});
