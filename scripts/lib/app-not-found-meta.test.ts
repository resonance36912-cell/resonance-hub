/**
 * SEO metadata + structured data contract for the /apps/<unknown> page.
 *
 * The not-found page must never be indexed (it's a dead URL) but must still
 * describe itself honestly and expose the fuzzy suggestions as machine-readable
 * ItemList data pointing at canonical /apps/<key> URLs.
 */
import { describe, expect, it } from "bun:test";
import { APP_REGISTRY, type AppKey } from "../../src/lib/app-registry";
import { suggestApps } from "../../src/lib/app-slug-suggest";
import {
  NOT_FOUND_OG_IMAGE,
  NOT_FOUND_OG_IMAGE_ALT,
  notFoundDescription,
  notFoundPageUrl,
  notFoundHead,
  notFoundStructuredData,
  notFoundTitle,
} from "../../src/lib/app-not-found-meta";
import { SITE_ORIGIN, appDetailUrl } from "../../src/lib/app-status-meta";

const MATCHED = "sinc-vision";
const MANY = "o";
const NO_MATCH = "zzzzzzzzzzzz";
const KEYS = Object.keys(APP_REGISTRY) as AppKey[];

const metaMap = (slug: string) => {
  const map = new Map<string, string>();
  for (const tag of notFoundHead(slug).meta) {
    if ("title" in tag) map.set("title", tag.title);
    else if ("name" in tag) map.set(tag.name, tag.content);
    else map.set(tag.property, tag.content);
  }
  return map;
};

describe("not-found head — core SEO tags", () => {
  it("always sets a slug-specific title and description", () => {
    for (const slug of [MATCHED, MANY, NO_MATCH]) {
      const m = metaMap(slug);
      expect(m.get("title")).toBe(notFoundTitle(slug));
      expect(m.get("title")).toContain(slug);
      expect(m.get("title")!.length).toBeLessThan(70);
      expect(m.get("description")).toBe(notFoundDescription(slug));
      expect(m.get("description")!.length).toBeGreaterThan(30);
      expect(m.get("description")).not.toContain("Lovable");
    }
  });

  it("is noindex but follow, so suggestions stay crawlable", () => {
    for (const slug of [MATCHED, MANY, NO_MATCH]) {
      expect(metaMap(slug).get("robots")).toBe("noindex, follow");
    }
  });

  it("emits a self-referencing og:url and canonical for a dead URL", () => {
    const m = metaMap(MATCHED);
    expect(m.get("og:url")).toBe(`${SITE_ORIGIN}/apps/${MATCHED}`);
    expect(notFoundHead(MATCHED).links).toEqual([
      { rel: "canonical", href: `${SITE_ORIGIN}/apps/${MATCHED}` },
    ]);
  });

  it("keeps OpenGraph and Twitter tags in lockstep", () => {
    const m = metaMap(MATCHED);
    expect(m.get("og:title")).toBe(m.get("title"));
    expect(m.get("twitter:title")).toBe(m.get("title"));
    expect(m.get("og:description")).toBe(m.get("description"));
    expect(m.get("twitter:description")).toBe(m.get("description"));
    expect(m.get("og:type")).toBe("website");
    expect(m.get("twitter:card")).toBe("summary");
  });

  it("emits the shared absolute OG image on every not-found variant", () => {
    for (const slug of [MATCHED, MANY, NO_MATCH]) {
      const m = metaMap(slug);
      expect(m.get("og:image")).toBe(NOT_FOUND_OG_IMAGE);
      expect(m.get("twitter:image")).toBe(NOT_FOUND_OG_IMAGE);
      expect(m.get("og:image:alt")).toBe(NOT_FOUND_OG_IMAGE_ALT);
    }
  });

  it("exposes the slug and suggestion count as machine-readable meta", () => {
    for (const slug of [MATCHED, MANY, NO_MATCH]) {
      const m = metaMap(slug);
      expect(m.get("resonance:not-found-slug")).toBe(slug);
      expect(m.get("resonance:suggestion-count")).toBe(String(suggestApps(slug).length));
    }
  });
});

describe("not-found head — description names the matches", () => {
  it("lists every suggested app label when matches exist", () => {
    for (const slug of [MATCHED, MANY]) {
      const suggestions = suggestApps(slug);
      expect(suggestions.length).toBeGreaterThan(0);
      const desc = notFoundDescription(slug);
      for (const { entry } of suggestions) expect(desc).toContain(entry.label);
      expect(desc).toContain("Closest matches");
    }
  });

  it("falls back to a catalog pointer with zero matches", () => {
    const desc = notFoundDescription(NO_MATCH);
    expect(desc).toContain(NO_MATCH);
    expect(desc).toContain("catalog");
    expect(desc).not.toContain("Closest matches");
  });
});

describe("not-found head — ItemList structured data", () => {
  it("emits exactly one ld+json script when matches exist", () => {
    for (const slug of [MATCHED, MANY]) {
      const scripts = notFoundHead(slug).scripts;
      expect(scripts.length).toBe(1);
      expect(scripts[0].type).toBe("application/ld+json");
      expect(() => JSON.parse(scripts[0].children)).not.toThrow();
    }
  });

  it("emits no structured data when there are no matches", () => {
    expect(notFoundStructuredData(NO_MATCH)).toBeNull();
    expect(notFoundHead(NO_MATCH).scripts).toEqual([]);
    for (const slug of ["", "   ", "-", "___"]) {
      expect(notFoundStructuredData(slug)).toBeNull();
      expect(notFoundHead(slug).scripts).toEqual([]);
    }
  });

  it("describes a valid schema.org ItemList", () => {
    const data = notFoundStructuredData(MANY)!;
    expect(data["@context"]).toBe("https://schema.org");
    expect(data["@type"]).toBe("ItemList");
    const items = data.itemListElement as Array<Record<string, any>>;
    expect(data.numberOfItems).toBe(items.length);
    expect(items.length).toBe(suggestApps(MANY).length);
    expect(data.name).toContain(MANY);
  });

  it("mirrors suggestion order, position and canonical URLs", () => {
    for (const slug of [MATCHED, MANY]) {
      const suggestions = suggestApps(slug);
      const items = notFoundStructuredData(slug)!.itemListElement as Array<Record<string, any>>;
      items.forEach((item, i) => {
        const { entry } = suggestions[i];
        expect(item["@type"]).toBe("ListItem");
        expect(item.position).toBe(i + 1);
        expect(item.item["@type"]).toBe("SoftwareApplication");
        expect(item.item.name).toBe(entry.label);
        expect(item.item.url).toBe(appDetailUrl(entry.key));
        expect(item.item.url).toBe(`${SITE_ORIGIN}/apps/${entry.key}`);
        expect(item.item.url).not.toContain(`/apps/${slug}`);
        expect(item.item.description.length).toBeGreaterThan(10);
        expect(KEYS.some((k) => item.item.url.endsWith(`/apps/${k}`))).toBe(true);
      });
    }
  });

  it("uses absolute https URLs only", () => {
    const items = notFoundStructuredData(MANY)!.itemListElement as Array<Record<string, any>>;
    for (const item of items) expect(item.item.url.startsWith("https://")).toBe(true);
  });

  it("is deterministic for the same slug", () => {
    for (const slug of [MATCHED, MANY, NO_MATCH]) {
      expect(JSON.stringify(notFoundHead(slug))).toBe(JSON.stringify(notFoundHead(slug)));
    }
  });

  it("stays valid for every registry key used as a near-miss slug", () => {
    for (const key of KEYS) {
      const slug = `${key.replace(/_/g, "-")}x`;
      const head = notFoundHead(slug);
      expect(head.meta.length).toBeGreaterThan(5);
      if (head.scripts.length) {
        const parsed = JSON.parse(head.scripts[0].children);
        expect(parsed["@type"]).toBe("ItemList");
        expect(parsed.itemListElement.length).toBe(suggestApps(slug).length);
      }
    }
  });
});

describe("not-found canonical + OG image", () => {
  const SLUGS = ["sinc-vision", "creative", "epub", "zzzzzzzzzzzz"];

  for (const slug of SLUGS) {
    it(`[${slug}] emits exactly one self-referencing canonical`, () => {
      const { links } = notFoundHead(slug);
      expect(links).toEqual([
        { rel: "canonical", href: `https://reson8.life/apps/${slug}` },
      ]);
    });

    it(`[${slug}] og:url matches the canonical href`, () => {
      const head = notFoundHead(slug);
      const ogUrl = head.meta.find(
        (m) => (m as { property?: string }).property === "og:url",
      ) as { content: string } | undefined;
      expect(ogUrl?.content).toBe(head.links[0]!.href);
    });

    it(`[${slug}] og:image and twitter:image are the same absolute https URL`, () => {
      const { meta } = notFoundHead(slug);
      const get = (key: string) =>
        (meta.find(
          (m) =>
            (m as { property?: string }).property === key ||
            (m as { name?: string }).name === key,
        ) as { content: string } | undefined)?.content;
      expect(get("og:image")).toBe(NOT_FOUND_OG_IMAGE);
      expect(get("twitter:image")).toBe(NOT_FOUND_OG_IMAGE);
      expect(NOT_FOUND_OG_IMAGE.startsWith("https://")).toBe(true);
      expect(get("og:image:alt")).toBe(NOT_FOUND_OG_IMAGE_ALT);
      expect(get("twitter:image:alt")).toBe(NOT_FOUND_OG_IMAGE_ALT);
      expect(get("og:image:width")).toBe("1024");
      expect(get("og:image:height")).toBe("1024");
    });
  }

  it("canonical never points at a suggested app or the catalog", () => {
    const href = notFoundHead("sinc-vision").links[0]!.href;
    expect(href).toBe("https://reson8.life/apps/sinc-vision");
    expect(href).not.toContain("sync_vision");
    expect(href.endsWith("/apps")).toBe(false);
  });

  it("encodes unsafe slugs in canonical and og:url", () => {
    const href = notFoundPageUrl("a b/c?d");
    expect(href).toBe(`https://reson8.life/apps/${encodeURIComponent("a b/c?d")}`);
    expect(href).not.toContain("?d");
  });
});
