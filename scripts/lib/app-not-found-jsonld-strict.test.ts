/**
 * Strict-mode schema validation for the generated not-found JSON-LD.
 *
 * The non-strict validator tolerates extra properties on the ItemList root and
 * on ListItem nodes (schema.org allows them). These tests pin what our own
 * generator emits: exactly the documented properties, nothing more. A stray key
 * — a debug field, a leftover experiment, a renamed property — fails here
 * before it can ship into crawler-visible markup.
 */
import { describe, expect, it } from "vitest";
import { notFoundStructuredData } from "../../src/lib/app-not-found-meta";
import {
  formatIssues,
  validateItemList,
  ITEM_LIST_SPEC,
  LIST_ITEM_SPEC,
  SOFTWARE_APPLICATION_SPEC,
} from "./schema-org-validate";

const MATCH_SLUGS = [
  "sinc-vision",
  "sync-vison",
  "creativ-studio",
  "epublishr",
  "yt-optimizer",
  "youtube",
  "resonance",
  "all-acces",
];

const NO_MATCH_SLUGS = ["zzzzzzzzzzzz", "qqqqqqqqqq", "1234567890", ""];

const ROOT_KEYS = new Set(["@context", "@type", ...Object.keys(ITEM_LIST_SPEC.fields)]);
const LIST_ITEM_KEYS = new Set(["@type", ...Object.keys(LIST_ITEM_SPEC.fields)]);
const APP_KEYS = new Set(["@type", ...Object.keys(SOFTWARE_APPLICATION_SPEC.fields)]);

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

describe("not-found JSON-LD passes strict schema validation", () => {
  for (const slug of MATCH_SLUGS) {
    it(`emits a strictly schema-valid ItemList for "${slug}"`, () => {
      const payload = notFoundStructuredData(slug);
      expect(payload).not.toBeNull();
      const issues = validateItemList(payload, { strict: true });
      expect(formatIssues(issues)).toBe("no issues");
    });

    it(`uses only documented properties for "${slug}"`, () => {
      const payload = notFoundStructuredData(slug) as Record<string, unknown>;
      for (const key of Object.keys(payload)) {
        expect(ROOT_KEYS.has(key), `root property "${key}"`).toBe(true);
      }
      const elements = payload["itemListElement"] as Array<Record<string, unknown>>;
      expect(Array.isArray(elements)).toBe(true);
      for (const element of elements) {
        for (const key of Object.keys(element)) {
          expect(LIST_ITEM_KEYS.has(key), `ListItem property "${key}"`).toBe(true);
        }
        const item = element["item"] as Record<string, unknown>;
        for (const key of Object.keys(item)) {
          expect(APP_KEYS.has(key), `SoftwareApplication property "${key}"`).toBe(true);
        }
      }
    });
  }

  for (const slug of NO_MATCH_SLUGS) {
    it(`omits JSON-LD entirely for zero-match slug "${slug}"`, () => {
      expect(notFoundStructuredData(slug)).toBeNull();
    });
  }
});

describe("strict mode catches drift the lenient mode allows", () => {
  const base = () => clone(notFoundStructuredData("sinc-vision")) as Record<string, unknown>;

  it("flags an extra property on the ItemList root only in strict mode", () => {
    const payload = base();
    payload["debugSuggestionScores"] = [0.91, 0.4];
    expect(validateItemList(payload)).toHaveLength(0);
    const strict = validateItemList(payload, { strict: true });
    expect(formatIssues(strict)).toMatch(/unexpected property "debugSuggestionScores"/);
    expect(strict[0]?.path).toBe("debugSuggestionScores");
  });

  it("flags an extra property on a ListItem only in strict mode", () => {
    const payload = base();
    const elements = payload["itemListElement"] as Array<Record<string, unknown>>;
    elements[0]!["score"] = 0.87;
    expect(validateItemList(payload)).toHaveLength(0);
    const strict = validateItemList(payload, { strict: true });
    expect(formatIssues(strict)).toMatch(/itemListElement\[0\]\.score: unexpected property/);
  });

  it("flags an extra property on a nested SoftwareApplication in both modes", () => {
    const payload = base();
    const elements = payload["itemListElement"] as Array<Record<string, unknown>>;
    (elements[0]!["item"] as Record<string, unknown>)["internalKey"] = "sync_vision";
    expect(validateItemList(payload).length).toBeGreaterThan(0);
    expect(formatIssues(validateItemList(payload, { strict: true }))).toMatch(
      /itemListElement\[0\]\.item\.internalKey: unexpected property/,
    );
  });

  it("reports every stray property, not just the first", () => {
    const payload = base();
    payload["foo"] = 1;
    payload["bar"] = 2;
    const strict = validateItemList(payload, { strict: true });
    const paths = strict.map((issue) => issue.path);
    expect(paths).toContain("foo");
    expect(paths).toContain("bar");
  });

  it("still accepts the untouched payload in strict mode", () => {
    expect(validateItemList(base(), { strict: true })).toHaveLength(0);
  });

  it("does not mutate the payload while validating strictly", () => {
    const payload = base();
    const before = JSON.stringify(payload);
    validateItemList(payload, { strict: true });
    expect(JSON.stringify(payload)).toBe(before);
  });

  it("rejects non-object payloads in strict mode too", () => {
    for (const bad of [null, undefined, "ItemList", 7, []]) {
      expect(validateItemList(bad, { strict: true }).length).toBeGreaterThan(0);
    }
  });
});
