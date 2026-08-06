/**
 * Locks the status badge shown for every app in the Hub catalog.
 *
 * Two layers are asserted:
 *
 *  1. EXPECTED_STATUS — an explicit, human-reviewed snapshot of the
 *     lifecycle status for every APP_REGISTRY and ECOSYSTEM_REGISTRY key.
 *     Flipping a status in src/lib/app-registry.ts now requires flipping it
 *     here too, so nobody silently marks a shipped app "beta" again (the
 *     Sync Vision regression) or marks an unreleased app "live".
 *  2. The badge/access wording each status resolves to via
 *     src/lib/app-status-meaning.ts, plus a guard that /apps and
 *     /apps/$appKey render from that shared module instead of re-declaring
 *     their own label maps.
 *
 * Run: bun test scripts/lib/app-status-badge.test.ts
 */

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { APP_REGISTRY, ECOSYSTEM_REGISTRY, type AppStatus } from "../../src/lib/app-registry";
import {
  APP_STATUS_LEGEND,
  APP_STATUS_MEANING,
  statusMeaning,
} from "../../src/lib/app-status-meaning";

const ROOT = join(import.meta.dir, "..", "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

/** Reviewed expectation — update deliberately when an app's lifecycle changes. */
const EXPECTED_STATUS: Record<string, AppStatus> = {
  // Paid suite (APP_REGISTRY)
  epublisher: "live",
  creative_studio: "live",
  sync_vision: "live",
  youtube_optimizer: "pilot",
  all_access: "live",
  // Wider ecosystem (ECOSYSTEM_REGISTRY)
  podcast: "live",
  career_compass: "pilot",
  resonance_app_dev: "live",
};

const ALL_ENTRIES: { key: string; label: string; status: AppStatus }[] = [
  ...Object.values(APP_REGISTRY).map((e) => ({ key: e.key, label: e.label, status: e.status })),
  ...Object.values(ECOSYSTEM_REGISTRY).map((e) => ({
    key: e.key,
    label: e.label,
    status: e.status,
  })),
];

describe("registry status snapshot", () => {
  it("covers every registry key with no extras", () => {
    expect(ALL_ENTRIES.map((e) => e.key).sort()).toEqual(Object.keys(EXPECTED_STATUS).sort());
  });

  for (const key of Object.keys(EXPECTED_STATUS)) {
    it(`${key} is "${EXPECTED_STATUS[key]}"`, () => {
      const found = ALL_ENTRIES.find((e) => e.key === key);
      expect(found).toBeDefined();
      expect(found!.status).toBe(EXPECTED_STATUS[key]!);
    });
  }

  it("sync_vision is live, not beta (regression: deployed app badged Beta)", () => {
    expect(APP_REGISTRY.sync_vision.status).toBe("live");
    expect(APP_REGISTRY.sync_vision.status).not.toBe("beta");
  });
});

describe("badge text per app", () => {
  for (const entry of ALL_ENTRIES) {
    it(`${entry.key} renders an honest badge + access line`, () => {
      const meaning = statusMeaning(entry.status);
      expect(meaning.label.length).toBeGreaterThan(0);
      expect(meaning.access.length).toBeGreaterThan(0);
      expect(meaning.explanation.length).toBeGreaterThan(20);
      // Anything other than coming_soon must state that access is live.
      if (entry.status === "coming_soon") {
        expect(meaning.accessible).toBe(false);
        expect(meaning.access.toLowerCase()).not.toContain("live access");
      } else {
        expect(meaning.accessible).toBe(true);
        expect(meaning.access.toLowerCase()).toContain("live access");
      }
    });
  }

  it("beta and pilot say badge-vs-access explicitly", () => {
    expect(APP_STATUS_MEANING.beta.access).toBe("Beta badge, live access");
    expect(APP_STATUS_MEANING.pilot.access).toBe("Pilot badge, live access");
    expect(APP_STATUS_MEANING.live.access).toBe("Live access");
    expect(APP_STATUS_MEANING.coming_soon.accessible).toBe(false);
  });

  it("legend covers every status in the AppStatus union", () => {
    expect([...APP_STATUS_LEGEND].sort()).toEqual(
      (Object.keys(APP_STATUS_MEANING) as AppStatus[]).sort(),
    );
  });
});

describe("catalog surfaces use the shared meaning module", () => {
  const catalog = read("src/routes/apps.tsx");
  const detail = read("src/routes/apps.$appKey.tsx");

  it("/apps imports the shared module and renders the legend", () => {
    expect(catalog).toContain("@/lib/app-status-meaning");
    expect(catalog).toContain("APP_STATUS_LEGEND");
    expect(catalog).toContain("What the status badges mean");
    expect(catalog).toContain("statusMeaning(tile.status)");
  });

  it("/apps/$appKey imports the shared module and explains the badge", () => {
    expect(detail).toContain("@/lib/app-status-meaning");
    expect(detail).toContain("statusMeaning(entry.status)");
    expect(detail).toContain("meaning.explanation");
  });

  it("neither page re-declares a local status label map", () => {
    expect(catalog).not.toMatch(/const STATUS_LABELS\s*[:=]/);
    expect(detail).not.toMatch(/const STATUS_LABELS\s*[:=]/);
  });
});
