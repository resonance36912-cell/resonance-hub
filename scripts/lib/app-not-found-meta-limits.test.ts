/**
 * Escaping + length contract for the /apps/<unknown> SEO title & description.
 *
 * The slug is attacker-controlled (it comes straight from the URL), so the
 * generated strings must never carry markup/quote/control characters and must
 * stay inside the recommended SEO character budgets no matter how long or
 * hostile the input is.
 */
import { describe, expect, it } from "bun:test";
import { APP_REGISTRY, type AppKey } from "../../src/lib/app-registry";
import {
  NOT_FOUND_DESCRIPTION_MAX,
  NOT_FOUND_TITLE_MAX,
  clampText,
  notFoundDescription,
  notFoundHead,
  notFoundTitle,
  sanitizeSlugForMeta,
} from "../../src/lib/app-not-found-meta";

const KEYS = Object.keys(APP_REGISTRY) as AppKey[];

/** Realistic typos, near-misses and no-match slugs. */
const ORDINARY = [
  ...KEYS,
  ...KEYS.map((k) => k.replace(/_/g, "-")),
  "sinc-vision",
  "creativ",
  "epublish",
  "youtube",
  "o",
  "e",
  "zzzzzzzzzzzz",
  "aaa",
];

/** Injection / abuse payloads. */
const HOSTILE = [
  '"><script>alert(1)</script>',
  "'\"><img src=x onerror=alert(1)>",
  "</title><meta name=robots content=index>",
  "sync\u0000vision",
  "sync\u001bvision",
  "sync\nvision",
  "sync\tvision",
  "  padded  slug  ",
  "back\\slash",
  "tick`quote'double\"amp&",
  "&lt;already-escaped&gt;",
  "a".repeat(500),
  "sync-vision-" + "x".repeat(300),
  "–".repeat(120),
  "🙂".repeat(120),
  "",
  "   ",
  "-",
  "___",
];

const ALL = [...ORDINARY, ...HOSTILE];

const FORBIDDEN = /[<>&"'`\\]/;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;

describe("not-found meta — escaping", () => {
  it("never emits markup, quote or backslash characters in the title", () => {
    for (const slug of ALL) {
      const title = notFoundTitle(slug);
      expect(FORBIDDEN.test(title)).toBe(false);
      expect(CONTROL.test(title)).toBe(false);
    }
  });

  it("never emits markup, quote or control characters in the description", () => {
    for (const slug of ALL) {
      const desc = notFoundDescription(slug);
      // Apostrophe in "isn't" is intentionally the typographic-safe ASCII one
      // only inside our own copy; the slug portion must carry none.
      expect(CONTROL.test(desc)).toBe(false);
      expect(desc).not.toContain("<");
      expect(desc).not.toContain(">");
      expect(desc).not.toContain('"');
      expect(desc).not.toContain("`");
      expect(desc).not.toContain("\\");
    }
  });

  it("cannot break out of a head tag or JSON-LD string", () => {
    for (const slug of HOSTILE) {
      const head = notFoundHead(slug);
      const serialized = JSON.stringify(head);
      expect(() => JSON.parse(serialized)).not.toThrow();
      for (const tag of head.meta) {
        const value = "title" in tag ? tag.title : tag.content;
        expect(value).not.toContain("</");
        expect(value).not.toContain("<script");
      }
      for (const script of head.scripts) {
        expect(script.children).not.toContain("</script");
        expect(() => JSON.parse(script.children)).not.toThrow();
      }
    }
  });

  it("strips control characters and collapses whitespace in sanitizeSlugForMeta", () => {
    expect(sanitizeSlugForMeta("sync\u0000vision", 40)).toBe("syncvision");
    expect(sanitizeSlugForMeta("sync   vision", 40)).toBe("sync vision");
    expect(sanitizeSlugForMeta("  padded  ", 40)).toBe("padded");
    expect(sanitizeSlugForMeta('<img src="x">', 40)).toBe("img src=x");
    expect(sanitizeSlugForMeta("", 40)).toBe("");
  });
});

describe("not-found meta — length limits", () => {
  it(`keeps every title within ${NOT_FOUND_TITLE_MAX} characters`, () => {
    for (const slug of ALL) {
      const title = notFoundTitle(slug);
      expect(Array.from(title).length).toBeLessThanOrEqual(NOT_FOUND_TITLE_MAX);
      expect(title.length).toBeGreaterThan(0);
    }
  });

  it(`keeps every description within ${NOT_FOUND_DESCRIPTION_MAX} characters`, () => {
    for (const slug of ALL) {
      const desc = notFoundDescription(slug);
      expect(Array.from(desc).length).toBeLessThanOrEqual(NOT_FOUND_DESCRIPTION_MAX);
      expect(desc.length).toBeGreaterThan(0);
    }
  });

  it("mirrors the same clamped values into og:/twitter: tags", () => {
    for (const slug of [...ORDINARY.slice(0, 6), ...HOSTILE]) {
      const title = notFoundTitle(slug);
      const desc = notFoundDescription(slug);
      for (const tag of notFoundHead(slug).meta) {
        if ("title" in tag) expect(tag.title).toBe(title);
        else if (tag.property === "og:title" || tag.name === "twitter:title")
          expect(tag.content).toBe(title);
        else if (
          tag.name === "description" ||
          tag.property === "og:description" ||
          tag.name === "twitter:description"
        )
          expect(tag.content).toBe(desc);
      }
    }
  });

  it("marks truncation with a single trailing ellipsis, never a cut word plus junk", () => {
    const long = notFoundTitle("a".repeat(500));
    expect(long.endsWith(" — Resonance Apps")).toBe(true);
    expect(long).toContain("…");
    expect(long.split("…").length - 1).toBe(1);
  });

  it("drops surplus labels instead of mid-sentence truncation", () => {
    for (const slug of ALL) {
      const desc = notFoundDescription(slug);
      expect(desc.endsWith(".")).toBe(true);
    }
  });

  it("keeps ordinary typo slugs comfortably inside the budgets", () => {
    for (const slug of ORDINARY) {
      expect(notFoundTitle(slug).length).toBeLessThanOrEqual(NOT_FOUND_TITLE_MAX);
      expect(notFoundTitle(slug)).not.toContain("…");
      expect(notFoundDescription(slug).length).toBeLessThanOrEqual(NOT_FOUND_DESCRIPTION_MAX);
    }
  });

  it("counts astral characters by code point, not UTF-16 units", () => {
    const title = notFoundTitle("🙂".repeat(120));
    expect(Array.from(title).length).toBeLessThanOrEqual(NOT_FOUND_TITLE_MAX);
    const desc = notFoundDescription("🙂".repeat(120));
    expect(Array.from(desc).length).toBeLessThanOrEqual(NOT_FOUND_DESCRIPTION_MAX);
  });
});

describe("clampText", () => {
  it("returns short input untouched", () => {
    expect(clampText("hello", 10)).toBe("hello");
    expect(clampText("hello", 5)).toBe("hello");
  });

  it("truncates with an ellipsis at exactly max length", () => {
    const out = clampText("abcdefghij", 5);
    expect(out).toBe("abcd…");
    expect(Array.from(out).length).toBe(5);
  });

  it("trims whitespace before the ellipsis", () => {
    expect(clampText("abc defgh", 5)).toBe("abc…");
  });

  it("handles degenerate maxima", () => {
    expect(clampText("abc", 1)).toBe("a");
    expect(clampText("abc", 0)).toBe("");
  });

  it("is idempotent", () => {
    const once = clampText("x".repeat(200), 40);
    expect(clampText(once, 40)).toBe(once);
  });
});
