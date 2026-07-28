import { describe, expect, test } from "bun:test";
import {
  ALLOWED_RETURN_TO_ORIGINS,
  isAllowedReturnTo,
  sanitizeReturnTo,
} from "../../src/lib/return-to-allowlist";

// Pick a stable allowlisted origin to build fixtures from. The Hub's canonical
// origin is always present.
const HUB = "https://reson8.life";

describe("isAllowedReturnTo — normalization edge cases", () => {
  test("baseline: canonical hub origin is allowlisted", () => {
    expect(ALLOWED_RETURN_TO_ORIGINS).toContain(HUB);
    expect(isAllowedReturnTo(HUB)).toBe(true);
  });

  describe("trailing slashes & path variants (allowed)", () => {
    for (const suffix of [
      "/",
      "/account",
      "/account/",
      "/account/subscriptions",
      "/pricing#packs",
      "/checkout?sku=studio-poster-pack",
      "//double-slash-path",
      "/%20/percent-encoded-path",
      "/deep/path/../still-same-origin",
    ]) {
      test(`accepts ${HUB}${suffix}`, () => {
        expect(isAllowedReturnTo(`${HUB}${suffix}`)).toBe(true);
        expect(sanitizeReturnTo(`${HUB}${suffix}`)).toBe(`${HUB}${suffix}`);
      });
    }
  });

  describe("uppercase / mixed-case hosts (allowed — WHATWG lowercases host)", () => {
    for (const variant of [
      "https://RESON8.LIFE/",
      "https://Reson8.Life/account",
      "https://reson8.LIFE/pricing#packs",
    ]) {
      test(`accepts ${variant}`, () => {
        expect(isAllowedReturnTo(variant)).toBe(true);
      });
    }

    test("uppercase scheme is normalized by the parser", () => {
      // `HTTPS://` is normalized to `https://` by the URL parser.
      expect(isAllowedReturnTo("HTTPS://reson8.life/")).toBe(true);
    });
  });

  describe("default-port normalization (allowed)", () => {
    test("explicit :443 on https collapses to canonical origin", () => {
      expect(isAllowedReturnTo("https://reson8.life:443/account")).toBe(true);
    });
  });

  describe("percent-encoded host characters (allowed — decoded by parser)", () => {
    // %38 == '8', so this decodes to reson8.life.
    test("percent-encoded ASCII host char is decoded", () => {
      expect(isAllowedReturnTo("https://reson%38.life/")).toBe(true);
    });

    test("percent-encoding in the *path* does not change the origin", () => {
      expect(isAllowedReturnTo("https://reson8.life/%2e%2e/")).toBe(true);
    });
  });

  describe("host variants that must NOT match", () => {
    for (const bad of [
      // Trailing dot host — parser preserves the dot, so origin differs.
      "https://reson8.life./",
      // Phish lookalike.
      "https://reson8.life.evil.example/",
      // Subdomain not in allowlist.
      "https://not-a-real-sub.reson8.life/",
      // Homoglyph / cyrillic look-alike (`а` U+0430, not ASCII `a`).
      "https://rеson8.life/",
      // Wrong TLD.
      "https://reson8.co/",
    ]) {
      test(`rejects ${bad}`, () => {
        expect(isAllowedReturnTo(bad)).toBe(false);
        expect(sanitizeReturnTo(bad)).toBeUndefined();
      });
    }
  });

  describe("userinfo smuggling (must NOT match)", () => {
    // The WHATWG URL `.origin` field ignores userinfo, so
    // `https://evil.com@reson8.life/` naively looks like reson8.life.
    // We must reject any URL that carries userinfo.
    for (const bad of [
      "https://evil.com@reson8.life/",
      "https://user:pass@reson8.life/account",
      "https://%65vil.com@reson8.life/", // percent-encoded userinfo
    ]) {
      test(`rejects ${bad}`, () => {
        expect(isAllowedReturnTo(bad)).toBe(false);
      });
    }
  });

  describe("non-http(s) schemes (must NOT match)", () => {
    for (const bad of [
      "javascript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "file:///etc/passwd",
      "ftp://reson8.life/",
      "vbscript:msgbox(1)",
    ]) {
      test(`rejects ${bad}`, () => {
        expect(isAllowedReturnTo(bad)).toBe(false);
      });
    }
  });

  describe("relative / malformed inputs (must NOT match)", () => {
    for (const bad of [
      "",
      " ",
      "/account",
      "//reson8.life/x", // protocol-relative
      "reson8.life/x",
      "https://",
      "https:///path-no-host",
      "not a url at all",
    ]) {
      test(`rejects ${JSON.stringify(bad)}`, () => {
        expect(isAllowedReturnTo(bad)).toBe(false);
      });
    }

    test("null / undefined are rejected", () => {
      expect(isAllowedReturnTo(null)).toBe(false);
      expect(isAllowedReturnTo(undefined)).toBe(false);
      expect(sanitizeReturnTo(null)).toBeUndefined();
      expect(sanitizeReturnTo(undefined)).toBeUndefined();
    });
  });

  describe("sanitizeReturnTo preserves the exact caller-provided string", () => {
    // Normalization happens for *comparison*, but the returned value is the
    // original input so downstream consumers (PayFast return_url, CTA href)
    // keep the caller's query string / fragment / trailing slash.
    const preserved = [
      "https://reson8.life/",
      "https://reson8.life/account/subscriptions?ref=x#top",
      "https://RESON8.LIFE/mixed-case",
      "https://reson8.life:443/explicit-port",
    ];
    for (const url of preserved) {
      test(`round-trips ${url}`, () => {
        expect(sanitizeReturnTo(url)).toBe(url);
      });
    }
  });
});
