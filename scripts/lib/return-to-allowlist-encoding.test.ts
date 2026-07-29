/**
 * Path/query encoding invariants for the `return_to` allowlist.
 *
 * The allowlist compares WHATWG-parsed *origins*, so nothing in a URL's
 * path, query, or fragment — no matter how encoded — should be able to
 * change the allowlist verdict. This suite pins that property against
 * percent-encoded and mixed-encoded path/query variants that historically
 * have been used to smuggle characters past naive string checks:
 *
 *   • `%2F` (encoded `/`) in the path — must NOT be decoded before origin
 *     comparison; the host must remain untouched.
 *   • `%3F` (encoded `?`) in the path — must NOT split into a query and
 *     graft a new host.
 *   • Repeated slashes (`//`, `///`) in the path — must NOT be parsed as a
 *     protocol-relative host takeover.
 *   • `%2E%2E` / `%2e%2e` (encoded `..`) — dot-segment obfuscation must
 *     not affect the origin.
 *   • Encoded query separators, fragments, whitespace, control chars,
 *     newlines, tabs, and NULs in the path/query.
 *   • Double- and triple-encoded sequences (`%252F`, `%25252F`) — must be
 *     treated as literal `%2F`-shaped path characters, not decoded.
 *   • Bidi/RTL override control chars in the path — origin is unchanged.
 *
 * In every case the assertions are:
 *   1. `isAllowedReturnTo(url)` matches the allowlist status of the origin
 *      as computed by the WHATWG URL parser (no path/query influence).
 *   2. When accepted, `sanitizeReturnTo` returns the *exact* caller string
 *      byte-for-byte, so downstream consumers (PayFast `return_url`, CTA
 *      href) receive what the caller asked for — the allowlist does the
 *      security check, it does not rewrite the URL.
 *   3. Attaching the same shady path/query onto a non-allowlisted host
 *      never sneaks past the check.
 */
import { describe, expect, test } from "vitest";
import {
  ALLOWED_RETURN_TO_ORIGINS,
  isAllowedReturnTo,
  sanitizeReturnTo,
} from "../../src/lib/return-to-allowlist";

const HUB = "https://reson8.life";
const EVIL = "https://evil.example";

function parsedOrigin(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/**
 * The contract in one place: the allowlist verdict is a pure function of the
 * parsed origin, not the raw string. If the parser produces an origin in the
 * allowlist, the URL is accepted; otherwise it isn't.
 */
function expectOriginBasedVerdict(url: string) {
  const origin = parsedOrigin(url);
  const expected =
    origin !== null && ALLOWED_RETURN_TO_ORIGINS.includes(origin);
  expect(isAllowedReturnTo(url)).toBe(expected);
  expect(sanitizeReturnTo(url)).toBe(expected ? url : undefined);
}

describe("return_to — percent/mixed encoding in path & query does NOT bypass origin check", () => {
  test("baseline: hub origin is allowlisted, evil origin is not", () => {
    expect(ALLOWED_RETURN_TO_ORIGINS).toContain(HUB);
    expect(ALLOWED_RETURN_TO_ORIGINS).not.toContain(EVIL);
  });

  describe("hub origin + shady path/query — MUST stay allowed", () => {
    for (const suffix of [
      // %2F (encoded slash) in path
      "/account%2Fsubscriptions",
      "/deep/%2F/still-same-origin",
      // %3F (encoded question mark) in path — must NOT split into query
      "/pricing%3Ffake=1",
      // Repeated slashes in path
      "//double",
      "///triple",
      "/a//b///c",
      // Encoded dot-segments
      "/%2E%2E/escape-me",
      "/%2e%2e/%2e%2e/root",
      "/legit/../account",
      // Double / triple encoding — must not chain-decode
      "/path/%252F/still-path",
      "/path/%25252F/still-path",
      // Mixed encoded query separators
      "/pricing?ref=%2F%3F%23",
      "/x?next=https%3A%2F%2Fevil.example%2Fphish",
      // Fragment carrying an entire attacker URL
      "/pricing#https://evil.example/phish",
      // Whitespace / control chars in the path (encoded)
      "/path%20with%20spaces",
      "/path%09tab",
      "/path%0Anewline",
      "/path%00nul",
      // Bidi/RTL override in path
      "/normal%E2%80%AEreversed",
      // Empty path with query only
      "?next=%2F%2Fevil.example",
      // Fragment only
      "#%2F%2Fevil.example",
      // Long percent-encoded blob
      "/" + "%2F".repeat(64),
    ]) {
      test(`accepts ${HUB}${suffix}`, () => {
        const url = `${HUB}${suffix}`;
        // The parser must resolve the origin to the hub — no path trick
        // should be able to change that.
        expect(parsedOrigin(url)).toBe(HUB);
        expectOriginBasedVerdict(url);
        // Belt-and-braces: the exact caller string is preserved.
        expect(sanitizeReturnTo(url)).toBe(url);
      });
    }
  });

  describe("evil origin + same shady path/query — MUST stay rejected", () => {
    for (const suffix of [
      "/account%2Fsubscriptions",
      "/pricing%3Ffake=1",
      "//double",
      "///triple",
      "/%2E%2E/escape-me",
      "/path/%252F/still-path",
      "/pricing?ref=%2F%3F%23",
      "/x?next=https%3A%2F%2Freson8.life%2Faccount", // hub URL smuggled in query
      "/pricing#https://reson8.life/account",
      "/path%00nul",
      "/normal%E2%80%AEreversed",
    ]) {
      test(`rejects ${EVIL}${suffix}`, () => {
        const url = `${EVIL}${suffix}`;
        expect(parsedOrigin(url)).toBe(EVIL);
        expectOriginBasedVerdict(url);
        expect(isAllowedReturnTo(url)).toBe(false);
        expect(sanitizeReturnTo(url)).toBeUndefined();
      });
    }
  });

  describe("path-shape lookalikes that ARE origin-changing — must be rejected", () => {
    // These strings LOOK like "hub path + junk" but the parser resolves the
    // origin to something else. If any of these ever flip to accepted, the
    // origin comparison has silently regressed.
    for (const bad of [
      // Protocol-relative — no scheme, entire "path" is really the host+path
      "//reson8.life/account",
      "///reson8.life/account",
      // Missing scheme — bare host string
      "reson8.life/account",
      // Percent-encoded scheme separator — not a valid absolute URL
      "https%3A%2F%2Freson8.life%2Faccount",
    ]) {
      test(`rejects ${JSON.stringify(bad)}`, () => {
        expect(isAllowedReturnTo(bad)).toBe(false);
        expect(sanitizeReturnTo(bad)).toBeUndefined();
      });
    }
  });

  describe("byte-exact preservation of accepted URLs", () => {
    // The security check normalizes for *comparison* (WHATWG parse), but
    // must NOT rewrite the string. Downstream (PayFast return_url, CTA
    // href) needs the exact bytes the caller sent — otherwise
    // path-sensitive routes on the spoke could break.
    for (const url of [
      `${HUB}/account%2Fsubscriptions`,
      `${HUB}/pricing%3Ffake=1?real=1#packs`,
      `${HUB}//double/slash`,
      `${HUB}/path/%252F/keep-as-literal`,
      `${HUB}/%E2%9C%93/utf8-check`,
      `${HUB}/mixed/CASE/preserved?Q=Value`,
    ]) {
      test(`round-trips ${url}`, () => {
        expect(sanitizeReturnTo(url)).toBe(url);
      });
    }
  });
});
