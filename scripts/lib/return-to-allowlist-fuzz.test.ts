/**
 * Property-based fuzz tests for the `return_to` allowlist + checkout success
 * pipeline. These complement the enumerative tests in
 * `return-to-allowlist-normalization.test.ts` and
 * `checkout-success-return-to-allowlist.test.ts` by asserting invariants that
 * must hold for EVERY possible attacker-controlled input, not just the
 * hand-picked cases we thought of.
 *
 * Invariants under test:
 *
 *   I1. isAllowedReturnTo(x) === true  ⟹  safeOrigin(x) ∈ ALLOWED_RETURN_TO_ORIGINS
 *   I2. sanitizeReturnTo(x) ∈ { undefined, x }  (never a mutated string)
 *   I3. resolveCheckoutContext({ return_to: x }).returnTo is either
 *       undefined OR strictly equal to x AND allowlisted.
 *   I4. computeCheckoutSuccessCtas succeeded-phase primary target:
 *         if kind === "external" ⟹ href is allowlisted.
 *       i.e. no attacker input can make the auto-redirect navigate to an
 *       origin outside ALLOWED_RETURN_TO_ORIGINS.
 *   I5. Adversarial mutations built AROUND a known-allowlisted origin
 *       (prefix injection, suffix TLD grafting, userinfo smuggling, port
 *       rewrites to non-defaults, path/query grafts on lookalike hosts,
 *       homoglyph substitution, protocol downgrade) MUST NOT be accepted.
 */
import { describe, expect, it } from "bun:test";
import fc from "fast-check";

import {
  ALLOWED_RETURN_TO_ORIGINS,
  isAllowedReturnTo,
  sanitizeReturnTo,
} from "../../src/lib/return-to-allowlist";
import { resolveCheckoutContext } from "../../src/lib/checkout-return";
import { computeCheckoutSuccessCtas } from "../../src/lib/checkout-success-ctas";
import { PACK_CATALOG } from "../../src/lib/checkout.functions";

// A small pool of pack + pass SKUs to sweep through; the invariants must hold
// regardless of which checkout kind resolves the context.
const PACK_IDS = Object.keys(PACK_CATALOG);
const PASS_SKU = "all_access:creator_pass:monthly";

/** Parse and return `.origin` for anything URL-parseable, else null. */
function tryOrigin(x: string): string | null {
  try {
    const u = new URL(x);
    return u.origin;
  } catch {
    return null;
  }
}

/** Assert I4 for one random string against one random SKU/pack context. */
function assertNoCrossOriginLeak(candidate: string, ctxInput: {
  sku?: string; pack?: string;
}) {
  const ctx = resolveCheckoutContext({ ...ctxInput, return_to: candidate });

  // I3: returnTo is only ever the exact caller string, and only if allowlisted.
  if (ctx.returnTo !== undefined) {
    expect(ctx.returnTo).toBe(candidate);
    expect(isAllowedReturnTo(candidate)).toBe(true);
  }

  const primary = computeCheckoutSuccessCtas({ phase: "succeeded", ctx }).find(
    (c) => c.id === "primary",
  );
  expect(primary).toBeDefined();

  // I4: external target hrefs are always allowlisted, no matter what the
  // attacker put in `return_to`.
  if (primary!.target.kind === "external") {
    expect(isAllowedReturnTo(primary!.target.href)).toBe(true);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Arbitraries
// ─────────────────────────────────────────────────────────────────────────────

/** Any string, including empties, control chars, and huge blobs. */
const anyString = fc.string({ maxLength: 512 });

/** Strings that at least look URL-ish, to bias the fuzzer toward interesting inputs. */
const urlishString = fc.oneof(
  fc.webUrl(),
  fc.string({ maxLength: 128 }).map((s) => `https://${s}`),
  fc.string({ maxLength: 128 }).map((s) => `http://${s}`),
  fc.string({ maxLength: 128 }).map((s) => `${s}://reson8.life/`),
  fc.string({ maxLength: 128 }).map((s) => `//${s}`),
  fc.constantFrom(
    "",
    " ",
    "javascript:alert(1)",
    "data:text/html,x",
    "file:///etc/passwd",
    "vbscript:x",
    "about:blank",
    "chrome://settings",
    "//reson8.life/",
    "/account",
    "not a url",
    "\n",
    "\u0000",
  ),
);

/** An allowlisted origin sampled at random. */
const allowedOrigin = fc.constantFrom(...ALLOWED_RETURN_TO_ORIGINS);

/** Random ASCII path fragment (no scheme/host confusion). */
const pathFrag = fc
  .string({ maxLength: 32 })
  .map((s) => "/" + s.replace(/[\s?#]/g, "_"));

/**
 * Adversarial mutations that build a URL AROUND a known-allowlisted origin.
 * Every mutation here MUST be rejected by the allowlist. If any of these
 * slip through, we have a real open-redirect bug.
 */
const attackerMutation = fc
  .tuple(allowedOrigin, pathFrag, fc.string({ maxLength: 16 }))
  .chain(([origin, path, junk]) => {
    const { protocol, host } = new URL(origin);
    const isHttps = protocol === "https:";
    return fc.constantFrom<string>(
      // Suffix TLD graft: legit host becomes a subdomain of attacker's domain.
      `${protocol}//${host}.evil.example${path}`,
      `${protocol}//${host}.attacker.io${path}`,
      // Prefix subdomain that isn't in the allowlist.
      `${protocol}//sneaky-${junk || "x"}.${host}${path}`,
      // Userinfo smuggling — WHATWG origin ignores userinfo, so a naive check
      // that only looked at parsed.origin would see the allowlisted host.
      `${protocol}//evil.com@${host}${path}`,
      `${protocol}//user:pass@${host}${path}`,
      `${protocol}//%65vil.com@${host}${path}`,
      // Protocol downgrade / swap.
      `${isHttps ? "http" : "https"}://${host}${path}`,
      `ftp://${host}${path}`,
      `javascript://${host}/%0aalert(1)`,
      // Non-default port on an https origin (443 is default and collapses; any
      // other port yields a different origin string).
      isHttps ? `https://${host}:8443${path}` : `http://${host}:8081${path}`,
      // Trailing-dot host (parser preserves the dot ⇒ different origin).
      `${protocol}//${host}.${path}`,
      // Protocol-relative (no scheme at all).
      `//${host}${path}`,
      // Bare path with the host embedded as text (no scheme).
      `/${host}${path}`,
      // Fragment/query with an allowlisted URL EMBEDDED as a value on an
      // evil origin — historically tricks naive substring checks.
      `https://evil.example${path}?next=${encodeURIComponent(origin + path)}`,
      `https://evil.example${path}#${origin}`,
      // Homoglyph: replace ASCII `a` in host with Cyrillic `а` (U+0430),
      // and ASCII `e` with Cyrillic `е` (U+0435), if present.
      `${protocol}//${host.replace(/a/g, "\u0430").replace(/e/g, "\u0435")}${path}`,
    );
  });

const contextInputs = fc.oneof(
  fc.constant<{ sku: string }>({ sku: PASS_SKU }),
  ...PACK_IDS.map((id) => fc.constant<{ pack: string }>({ pack: id })),
);

// ─────────────────────────────────────────────────────────────────────────────
// Properties
// ─────────────────────────────────────────────────────────────────────────────

const FUZZ_RUNS = 500;

describe("return_to allowlist — property-based fuzz", () => {
  it("I1: isAllowedReturnTo(x)=true implies parsed origin is in the allowlist", () => {
    fc.assert(
      fc.property(fc.oneof(anyString, urlishString), (x) => {
        if (!isAllowedReturnTo(x)) return true; // vacuously satisfied
        const origin = tryOrigin(x);
        // If accepted, x MUST be parseable AND its origin MUST be allowlisted.
        expect(origin).not.toBeNull();
        expect(ALLOWED_RETURN_TO_ORIGINS).toContain(origin!);
        // And userinfo smuggling must never sneak past.
        const parsed = new URL(x);
        expect(parsed.username).toBe("");
        expect(parsed.password).toBe("");
        expect(parsed.protocol === "https:" || parsed.protocol === "http:").toBe(
          true,
        );
        return true;
      }),
      { numRuns: FUZZ_RUNS },
    );
  });

  it("I2: sanitizeReturnTo returns either undefined or the exact input string", () => {
    fc.assert(
      fc.property(fc.oneof(anyString, urlishString), (x) => {
        const out = sanitizeReturnTo(x);
        if (out === undefined) return true;
        expect(out).toBe(x);
        expect(isAllowedReturnTo(out)).toBe(true);
        return true;
      }),
      { numRuns: FUZZ_RUNS },
    );
  });

  it("I3+I4: no random return_to can produce a cross-origin succeeded-phase redirect", () => {
    fc.assert(
      fc.property(
        fc.oneof(anyString, urlishString),
        contextInputs,
        (candidate, ctxInput) => {
          assertNoCrossOriginLeak(candidate, ctxInput);
          return true;
        },
      ),
      { numRuns: FUZZ_RUNS },
    );
  });

  it("I5: adversarial mutations of allowlisted origins are ALWAYS rejected", () => {
    fc.assert(
      fc.property(attackerMutation, contextInputs, (candidate, ctxInput) => {
        // Direct allowlist check.
        expect(isAllowedReturnTo(candidate)).toBe(false);
        expect(sanitizeReturnTo(candidate)).toBeUndefined();

        // End-to-end through the checkout pipeline.
        const ctx = resolveCheckoutContext({ ...ctxInput, return_to: candidate });
        expect(ctx.returnTo).toBeUndefined();

        const primary = computeCheckoutSuccessCtas({
          phase: "succeeded",
          ctx,
        }).find((c) => c.id === "primary");
        expect(primary).toBeDefined();

        if (primary!.target.kind === "external") {
          // Fallback must still be allowlisted, and must not equal or contain
          // the attacker payload.
          expect(isAllowedReturnTo(primary!.target.href)).toBe(true);
          expect(primary!.target.href).not.toBe(candidate);
        }
        return true;
      }),
      { numRuns: FUZZ_RUNS },
    );
  });

  it("I3-null: null/undefined return_to never yields ctx.returnTo", () => {
    fc.assert(
      fc.property(
        fc.constantFrom<string | null | undefined>(null, undefined),
        contextInputs,
        (candidate, ctxInput) => {
          const ctx = resolveCheckoutContext({
            ...ctxInput,
            return_to: candidate,
          });
          expect(ctx.returnTo).toBeUndefined();
          const primary = computeCheckoutSuccessCtas({
            phase: "succeeded",
            ctx,
          }).find((c) => c.id === "primary");
          if (primary?.target.kind === "external") {
            expect(isAllowedReturnTo(primary.target.href)).toBe(true);
          }
          return true;
        },
      ),
      { numRuns: 50 },
    );
  });
});
