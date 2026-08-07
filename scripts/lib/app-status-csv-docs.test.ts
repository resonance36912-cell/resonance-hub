import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { APP_STATUS_CSV_HEADERS } from "@/lib/app-status-csv";
import { APP_STATUS_LEGEND, APP_STATUS_MEANING } from "@/lib/app-status-meaning";

/**
 * Keeps docs/api/app-status-csv.md honest: the column reference is what people
 * copy meanings from, so drift there is worse than no doc at all.
 */
const DOC_PATH = "docs/api/app-status-csv.md";
const doc = readFileSync(DOC_PATH, "utf8");

describe("app status CSV docs", () => {
  it("documents every header, in order, exactly once", () => {
    const documented = [...doc.matchAll(/^\| \d+ \| `([a-z_]+)` \|/gm)].map((m) => m[1]);
    expect(documented).toEqual([...APP_STATUS_CSV_HEADERS]);
  });

  it("documents every status with its badge label, access line and accessibility", () => {
    for (const status of APP_STATUS_LEGEND) {
      const meaning = APP_STATUS_MEANING[status];
      const row = doc
        .split("\n")
        .find((line) => line.startsWith(`| \`${status}\` |`));
      expect(row, `missing vocabulary row for ${status}`).toBeTruthy();
      expect(row).toContain(`| ${meaning.label} |`);
      expect(row).toContain(`| ${meaning.access} |`);
      expect(row).toContain(`\`${meaning.accessible}\``);
    }
  });

  it("documents both filter parameters and the derived tag facets", () => {
    for (const token of ["appKey", "tag", "accessible", "gated", "app", "ecosystem"]) {
      expect(doc).toContain(token);
    }
  });

  it("states the RFC 4180 / CRLF encoding contract", () => {
    expect(doc).toContain("RFC 4180");
    expect(doc).toContain("CRLF");
    expect(doc).toContain("UTF-8");
  });
});
