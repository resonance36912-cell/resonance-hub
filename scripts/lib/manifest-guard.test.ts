import { describe, expect, it } from "vitest";
import {
  GUARDED_MANIFESTS,
  buildSnapshot,
  diffSnapshots,
  formatChangeReport,
  hashContent,
} from "./manifest-guard";

describe("manifest-guard", () => {
  it("guards package.json and bun.lock", () => {
    expect([...GUARDED_MANIFESTS]).toEqual(["package.json", "bun.lock"]);
  });

  it("hashes deterministically", () => {
    expect(hashContent("a")).toBe(hashContent("a"));
    expect(hashContent("a")).not.toBe(hashContent("b"));
  });

  it("reports no changes for identical manifests", () => {
    const files = { "package.json": "{}", "bun.lock": "lock" };
    const changes = diffSnapshots(buildSnapshot(files), buildSnapshot(files));
    expect(changes).toEqual([]);
    expect(formatChangeReport(changes)).toContain("Manifests unchanged");
  });

  it("detects a modified lockfile", () => {
    const before = buildSnapshot({ "package.json": "{}", "bun.lock": "v1" });
    const after = buildSnapshot({ "package.json": "{}", "bun.lock": "v2" });
    const changes = diffSnapshots(before, after);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ file: "bun.lock", kind: "modified" });
    const report = formatChangeReport(changes);
    expect(report).toContain("Unexpected manifest mutation detected");
    expect(report).toContain("pinned devDependency");
  });

  it("detects created and deleted manifests", () => {
    const before = buildSnapshot({ "package.json": "{}", "bun.lock": null });
    const after = buildSnapshot({ "package.json": null, "bun.lock": "v1" });
    const kinds = diffSnapshots(before, after).map((c) => `${c.file}:${c.kind}`);
    expect(kinds.sort()).toEqual(["bun.lock:created", "package.json:deleted"]);
  });

  it("records a label and timestamp", () => {
    const snap = buildSnapshot({ "package.json": "{}" }, "prebuild", new Date(0));
    expect(snap.label).toBe("prebuild");
    expect(snap.createdAt).toBe("1970-01-01T00:00:00.000Z");
  });
});
