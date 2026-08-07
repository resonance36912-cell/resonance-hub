import { describe, expect, it } from "bun:test";
import {
  diffBaselines,
  extractBaseline,
  formatDriftMarkdown,
  summarizeDrift,
  type StatusBaseline,
} from "./app-status-drift";

const payload = {
  ok: true,
  schemaVersion: "2026-08-06",
  apps: [
    {
      key: "sync_vision",
      label: "Resonance Sync Vision",
      status: "live",
      badgeLabel: "Live",
      access: "Live access",
      accessible: true,
      explanation: "ignored",
    },
    {
      key: "youtube_optimizer",
      label: "YouTube Optimizer",
      status: "pilot",
      badgeLabel: "Pilot",
      access: "Pilot badge, live access",
      accessible: true,
    },
  ],
  ecosystem: [
    {
      key: "podcast",
      label: "The Resonance Podcast",
      status: "live",
      badgeLabel: "Live",
      access: "Live access",
      accessible: true,
    },
  ],
  legend: [
    { status: "live", label: "Live", access: "Live access", accessible: true },
    { status: "beta", label: "Beta", access: "Beta badge, live access", accessible: true },
  ],
};

function snapshot(): StatusBaseline {
  return extractBaseline(structuredClone(payload)).baseline;
}

describe("extractBaseline", () => {
  it("keeps only the watched fields and sorts by key", () => {
    const { baseline, errors } = extractBaseline(payload);
    expect(errors).toEqual([]);
    expect(baseline.apps.map((a) => a.key)).toEqual(["sync_vision", "youtube_optimizer"]);
    expect(Object.keys(baseline.apps[0]!).sort()).toEqual([
      "access",
      "accessible",
      "badgeLabel",
      "key",
      "label",
      "status",
    ]);
    expect(baseline.legend.map((l) => l.status)).toEqual(["beta", "live"]);
  });

  it("flags a payload that is not ok", () => {
    const { errors } = extractBaseline({ ...payload, ok: false });
    expect(errors).toContain('health payload is not "ok: true"');
  });

  it("flags missing arrays instead of throwing", () => {
    const { errors } = extractBaseline({ ok: true, schemaVersion: "x" });
    expect(errors).toContain('health payload "apps" is not an array');
    expect(errors).toContain('health payload "ecosystem" is not an array');
    expect(errors).toContain('health payload "legend" is not an array');
  });

  it("flags an entry with a missing badge label", () => {
    const broken = structuredClone(payload) as Record<string, any>;
    delete broken["apps"][0].badgeLabel;
    const { errors } = extractBaseline(broken);
    expect(errors).toContain('apps/sync_vision: missing string "badgeLabel"');
  });
});

describe("diffBaselines", () => {
  it("reports clean when nothing changed", () => {
    const report = diffBaselines(snapshot(), snapshot());
    expect(report.clean).toBe(true);
    expect(report.changes).toEqual([]);
  });

  it("detects a badge label change", () => {
    const live = snapshot();
    live.apps[0]!.badgeLabel = "Beta";
    const report = diffBaselines(snapshot(), live);
    expect(report.clean).toBe(false);
    expect(report.changes).toContainEqual({
      scope: "apps/sync_vision",
      field: "badgeLabel",
      before: "Live",
      after: "Beta",
    });
  });

  it("detects an access line change", () => {
    const live = snapshot();
    live.apps[1]!.access = "Not yet available";
    const report = diffBaselines(snapshot(), live);
    expect(report.changes).toContainEqual({
      scope: "apps/youtube_optimizer",
      field: "access",
      before: "Pilot badge, live access",
      after: "Not yet available",
    });
  });

  it("detects accessibility flips", () => {
    const live = snapshot();
    live.apps[0]!.accessible = false;
    const report = diffBaselines(snapshot(), live);
    expect(report.changes).toContainEqual({
      scope: "apps/sync_vision",
      field: "accessible",
      before: "true",
      after: "false",
    });
  });

  it("detects legend wording changes", () => {
    const live = snapshot();
    live.legend[0]!.access = "Beta badge, restricted access";
    const report = diffBaselines(snapshot(), live);
    expect(report.changes).toContainEqual({
      scope: "legend/beta",
      field: "access",
      before: "Beta badge, live access",
      after: "Beta badge, restricted access",
    });
  });

  it("detects ecosystem status changes", () => {
    const live = snapshot();
    live.ecosystem[0]!.status = "coming_soon";
    const report = diffBaselines(snapshot(), live);
    expect(report.changes.some((c) => c.scope === "ecosystem/podcast")).toBe(true);
  });

  it("detects added and removed apps", () => {
    const live = snapshot();
    live.apps.push({ ...live.apps[0]!, key: "brand_new" });
    const base = snapshot();
    base.apps.push({ ...base.apps[0]!, key: "retired" });
    const report = diffBaselines(base, live);
    expect(report.added).toContain("apps/brand_new");
    expect(report.removed).toContain("apps/retired");
    expect(report.clean).toBe(false);
  });

  it("detects a schema version bump", () => {
    const live = snapshot();
    live.schemaVersion = "2027-01-01";
    const report = diffBaselines(snapshot(), live);
    expect(report.changes).toContainEqual({
      scope: "payload",
      field: "schemaVersion",
      before: "2026-08-06",
      after: "2027-01-01",
    });
  });

  it("carries payload errors into the report", () => {
    const report = diffBaselines(snapshot(), snapshot(), ["boom"]);
    expect(report.clean).toBe(false);
    expect(report.errors).toEqual(["boom"]);
  });
});

describe("summaries", () => {
  it("summarizes a clean run", () => {
    const report = diffBaselines(snapshot(), snapshot());
    expect(summarizeDrift(report, "https://x/health")).toBe(
      "App status badges unchanged (https://x/health)",
    );
    expect(formatDriftMarkdown(report, "https://x/health")).not.toContain("Changed:");
  });

  it("summarizes and explains a drifted run", () => {
    const live = snapshot();
    live.apps[0]!.badgeLabel = "Beta";
    const report = diffBaselines(snapshot(), live);
    expect(summarizeDrift(report, "src")).toContain("1 changed");
    const md = formatDriftMarkdown(report, "src");
    expect(md).toContain("apps/sync_vision");
    expect(md).toContain('"Live" → "Beta"');
    expect(md).toContain("baseline:app-status");
  });
});
