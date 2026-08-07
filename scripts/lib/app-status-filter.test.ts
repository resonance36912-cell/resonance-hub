import { describe, expect, it } from "vitest";
import type { AppStatusCsvRow } from "@/lib/app-status-csv";
import {
  availableTags,
  filterAppStatusRows,
  filterSlug,
  parseAppStatusFilters,
  parseFilterValues,
  rowTags,
} from "@/lib/app-status-filter";

const row = (over: Partial<AppStatusCsvRow>): AppStatusCsvRow => ({
  scope: "app",
  key: "creative_studio",
  label: "Creative Studio",
  status: "live",
  badgeLabel: "Live",
  access: "Open to all",
  accessible: true,
  explanation: "Ready for everyone.",
  url: "https://example.com",
  detailPath: "/apps/creative_studio",
  ...over,
});

const rows: AppStatusCsvRow[] = [
  row({}),
  row({ key: "sync_vision", label: "Sync Vision", status: "pilot", badgeLabel: "Beta", accessible: true }),
  row({
    scope: "ecosystem",
    key: "hub",
    label: "Hub",
    status: "pilot",
    badgeLabel: "Beta",
    accessible: false,
    detailPath: "",
  }),
];

describe("rowTags", () => {
  it("derives scope, status and access facets", () => {
    expect(rowTags(rows[0]!)).toEqual(["app", "live", "accessible"]);
    expect(rowTags(rows[2]!)).toEqual(["ecosystem", "pilot", "gated"]);
  });

  it("lists available tags sorted and deduped", () => {
    expect(availableTags(rows)).toEqual(["accessible", "app", "ecosystem", "gated", "live", "pilot"]);
  });
});

describe("parseFilterValues", () => {
  it("splits commas, trims, lowercases and dedupes", () => {
    expect(parseFilterValues([" App , live", "APP", ""])).toEqual(["app", "live"]);
  });

  it("returns an empty list when absent", () => {
    expect(parseFilterValues(undefined)).toEqual([]);
  });
});

describe("filterAppStatusRows", () => {
  it("returns every row when no filters are given", () => {
    const res = filterAppStatusRows(rows, parseAppStatusFilters({}));
    expect(res.ok && res.rows).toHaveLength(3);
  });

  it("filters by appKey case-insensitively", () => {
    const res = filterAppStatusRows(rows, parseAppStatusFilters({ appKey: ["Sync_Vision"] }));
    expect(res.ok && res.rows.map((r) => r.key)).toEqual(["sync_vision"]);
  });

  it("ORs multiple appKeys", () => {
    const res = filterAppStatusRows(rows, parseAppStatusFilters({ appKey: ["hub,creative_studio"] }));
    expect(res.ok && res.rows.map((r) => r.key)).toEqual(["creative_studio", "hub"]);
  });

  it("ANDs multiple tags", () => {
    const res = filterAppStatusRows(rows, parseAppStatusFilters({ tag: ["app", "pilot"] }));
    expect(res.ok && res.rows.map((r) => r.key)).toEqual(["sync_vision"]);
  });

  it("combines appKey and tag filters", () => {
    const res = filterAppStatusRows(
      rows,
      parseAppStatusFilters({ appKey: ["creative_studio", "sync_vision"], tag: ["live"] }),
    );
    expect(res.ok && res.rows.map((r) => r.key)).toEqual(["creative_studio"]);
  });

  it("rejects unknown appKeys with valid values listed", () => {
    const res = filterAppStatusRows(rows, parseAppStatusFilters({ appKey: ["nope"] }));
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.unknownAppKeys).toEqual(["nope"]);
      expect(res.error).toContain("creative_studio");
    }
  });

  it("rejects unknown tags", () => {
    const res = filterAppStatusRows(rows, parseAppStatusFilters({ tag: ["retired"] }));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.unknownTags).toEqual(["retired"]);
  });

  it("allows an empty result set for a valid but non-matching combination", () => {
    const res = filterAppStatusRows(rows, parseAppStatusFilters({ tag: ["ecosystem", "live"] }));
    expect(res.ok && res.rows).toEqual([]);
  });
});

describe("filterSlug", () => {
  it("is empty without filters", () => {
    expect(filterSlug({ appKeys: [], tags: [] })).toBe("");
  });

  it("builds a filesystem-safe suffix", () => {
    expect(filterSlug({ appKeys: ["sync_vision"], tags: ["live"] })).toBe("-syncvision-live");
  });
});
