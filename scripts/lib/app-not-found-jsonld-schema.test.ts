/**
 * Validates the /apps/<unknown> not-found JSON-LD against the expected
 * schema.org ItemList + SoftwareApplication shape.
 *
 * Two halves:
 *  1. Positive: every generated payload (across many real-world bad slugs)
 *     passes the validator with zero issues.
 *  2. Negative (mutation testing): deliberately break one property at a
 *     time and assert the validator reports it. This proves the positive
 *     assertions above aren't vacuous.
 */
import { describe, expect, it } from "bun:test";

import { APP_REGISTRY } from "@/lib/app-registry";
import { notFoundHead, notFoundStructuredData } from "@/lib/app-not-found-meta";
import { suggestApps } from "@/lib/app-slug-suggest";
import {
  SOFTWARE_APPLICATION_SPEC,
  formatIssues,
  validateItemList,
  validateNode,
} from "./schema-org-validate";

/** Slugs a real visitor might land on — typos, casing, separators. */
const BAD_SLUGS = [
  "sinc-vision",
  "syncvision",
  "sync vision",
  "SyncVision",
  "sinkvision",
  "creative",
  "creative-studio-app",
  "epub",
  "e-publisher",
  "youtube",
  "yt-optimizer",
  "o",
  "s",
  "studio",
  "vision",
];

const SLUGS_WITH_MATCHES = BAD_SLUGS.filter((s) => suggestApps(s).length > 0);

function payloadFor(slug: string): Record<string, unknown> {
  const payload = notFoundStructuredData(slug);
  if (!payload) throw new Error(`expected structured data for "${slug}"`);
  return payload;
}

/** Deep clone so mutations never leak between cases. */
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Mutate a dotted path like `itemListElement.0.item.url`. */
function setPath(root: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split(".");
  let cursor: any = root;
  for (const part of parts.slice(0, -1)) cursor = cursor[part];
  const last = parts[parts.length - 1]!;
  if (value === undefined) delete cursor[last];
  else cursor[last] = value;
}

describe("not-found JSON-LD — valid payloads", () => {
  it("has at least one slug with matches to test", () => {
    expect(SLUGS_WITH_MATCHES.length).toBeGreaterThan(0);
  });

  for (const slug of SLUGS_WITH_MATCHES) {
    it(`[${slug}] passes ItemList schema validation`, () => {
      const issues = validateItemList(payloadFor(slug));
      expect(formatIssues(issues)).toBe("no issues");
      expect(issues).toEqual([]);
    });

    it(`[${slug}] every nested item is a valid SoftwareApplication`, () => {
      const payload = payloadFor(slug);
      const elements = payload["itemListElement"] as Array<Record<string, unknown>>;
      expect(elements.length).toBeGreaterThan(0);
      for (const element of elements) {
        const issues = validateNode(element["item"], SOFTWARE_APPLICATION_SPEC);
        expect(formatIssues(issues)).toBe("no issues");
      }
    });
  }

  it("validates the payload emitted through notFoundHead's script tag", () => {
    for (const slug of SLUGS_WITH_MATCHES) {
      const script = notFoundHead(slug).scripts[0];
      expect(script?.type).toBe("application/ld+json");
      const parsed = JSON.parse(script!.children) as unknown;
      const issues = validateItemList(parsed);
      expect(formatIssues(issues)).toBe("no issues");
    }
  });

  it("every registry app produces a schema-valid payload when suggested by its own key", () => {
    for (const key of Object.keys(APP_REGISTRY)) {
      const slug = key.replace(/_/g, "-") + "x"; // near-miss of a real key
      const payload = notFoundStructuredData(slug);
      if (!payload) continue;
      expect(formatIssues(validateItemList(payload))).toBe("no issues");
    }
  });

  it("emits no JSON-LD at all for an unmatchable slug", () => {
    expect(notFoundStructuredData("zzzzzzzzzzzz")).toBeNull();
    expect(notFoundHead("zzzzzzzzzzzz").scripts).toEqual([]);
  });
});

describe("not-found JSON-LD — validator catches broken payloads", () => {
  const base = () => clone(payloadFor("sinc-vision"));

  const mutations: Array<{ label: string; path: string; value: unknown; expect: RegExp }> = [
    // Root ItemList
    { label: "missing @context", path: "@context", value: undefined, expect: /@context/ },
    { label: "wrong @context", path: "@context", value: "http://schema.org", expect: /@context/ },
    { label: "wrong root @type", path: "@type", value: "BreadcrumbList", expect: /@type/ },
    { label: "missing root @type", path: "@type", value: undefined, expect: /@type/ },
    { label: "missing name", path: "name", value: undefined, expect: /name/ },
    { label: "empty name", path: "name", value: "   ", expect: /name/ },
    { label: "numeric name", path: "name", value: 42, expect: /expected string, got number/ },
    {
      label: "numberOfItems as string",
      path: "numberOfItems",
      value: "3",
      expect: /expected number, got string/,
    },
    {
      label: "numberOfItems mismatch",
      path: "numberOfItems",
      value: 99,
      expect: /does not match/,
    },
    { label: "numberOfItems zero", path: "numberOfItems", value: 0, expect: /numberOfItems/ },
    {
      label: "bogus itemListOrder",
      path: "itemListOrder",
      value: "descending",
      expect: /not one of/,
    },
    {
      label: "itemListElement not an array",
      path: "itemListElement",
      value: {},
      expect: /expected array, got object/,
    },
    { label: "empty itemListElement", path: "itemListElement", value: [], expect: /empty/ },
    // ListItem level
    {
      label: "wrong ListItem @type",
      path: "itemListElement.0.@type",
      value: "Thing",
      expect: /@type/,
    },
    {
      label: "position out of order",
      path: "itemListElement.0.position",
      value: 5,
      expect: /does not match array index/,
    },
    {
      label: "position as string",
      path: "itemListElement.0.position",
      value: "1",
      expect: /expected number, got string/,
    },
    {
      label: "missing position",
      path: "itemListElement.0.position",
      value: undefined,
      expect: /position/,
    },
    {
      label: "missing item",
      path: "itemListElement.0.item",
      value: undefined,
      expect: /item/,
    },
    {
      label: "item is a string",
      path: "itemListElement.0.item",
      value: "Sync Vision",
      expect: /expected object, got string/,
    },
    // SoftwareApplication level
    {
      label: "wrong item @type",
      path: "itemListElement.0.item.@type",
      value: "Product",
      expect: /SoftwareApplication/,
    },
    {
      label: "missing item name",
      path: "itemListElement.0.item.name",
      value: undefined,
      expect: /name/,
    },
    {
      label: "item name empty",
      path: "itemListElement.0.item.name",
      value: "",
      expect: /name/,
    },
    {
      label: "missing item description",
      path: "itemListElement.0.item.description",
      value: undefined,
      expect: /description/,
    },
    {
      label: "item description too short",
      path: "itemListElement.0.item.description",
      value: "hi",
      expect: /shorter than/,
    },
    {
      label: "relative item url",
      path: "itemListElement.0.item.url",
      value: "/apps/sync_vision",
      expect: /absolute https URL/,
    },
    {
      label: "http item url",
      path: "itemListElement.0.item.url",
      value: "http://reson8.life/apps/sync_vision",
      expect: /absolute https URL/,
    },
    {
      label: "missing item url",
      path: "itemListElement.0.item.url",
      value: undefined,
      expect: /url/,
    },
    {
      label: "item url as number",
      path: "itemListElement.0.item.url",
      value: 1,
      expect: /expected string, got number/,
    },
    {
      label: "missing applicationCategory",
      path: "itemListElement.0.item.applicationCategory",
      value: undefined,
      expect: /applicationCategory/,
    },
    {
      label: "stray item property",
      path: "itemListElement.0.item.price",
      value: "R99",
      expect: /unexpected property "price"/,
    },
  ];

  for (const mutation of mutations) {
    it(`flags: ${mutation.label}`, () => {
      const payload = base();
      setPath(payload, mutation.path, mutation.value);
      const issues = validateItemList(payload);
      expect(issues.length).toBeGreaterThan(0);
      const report = formatIssues(issues);
      expect(report).toMatch(mutation.expect);
    });
  }

  it("flags duplicate positions and duplicate item urls", () => {
    const payload = base();
    const elements = payload["itemListElement"] as Array<Record<string, unknown>>;
    if (elements.length < 2) return; // nothing to duplicate
    elements[1] = clone(elements[0]!);
    const report = formatIssues(validateItemList(payload));
    expect(report).toMatch(/duplicate/);
  });

  it("rejects non-object payloads outright", () => {
    for (const bad of [null, undefined, "ItemList", 7, []]) {
      const issues = validateItemList(bad);
      expect(issues.length).toBeGreaterThan(0);
    }
  });

  it("does not mutate the generated payload while validating", () => {
    const payload = payloadFor("sinc-vision");
    const before = JSON.stringify(payload);
    validateItemList(payload);
    expect(JSON.stringify(payload)).toBe(before);
  });
});
