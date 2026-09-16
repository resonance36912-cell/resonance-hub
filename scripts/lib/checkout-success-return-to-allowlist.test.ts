/**
 * `/checkout/success` auto-redirect + `return_to` allowlist contract.
 *
 * The `succeeded` phase auto-redirects to the primary CTA target. When the
 * caller passes a `return_to` query param, the target must ONLY honor it if
 * the URL's origin is on `ALLOWED_RETURN_TO_ORIGINS`. Any other value must
 * be dropped and the redirect must fall back to the default target
 * (registered app URL, else `/pricing#{passes,packs}`).
 *
 * Guards two things at once:
 *   1. Open-redirect: attacker-controlled `return_to` never navigates the user
 *      off-hub after a successful checkout.
 *   2. Legitimate deep-links: allowlisted origins DO override the default.
 */
import { describe, expect, it } from "bun:test";
import {
  computeCheckoutSuccessCtas,
  type Phase,
} from "../../src/lib/checkout-success-ctas";
import {
  resolveCheckoutContext,
  type CheckoutContext,
} from "../../src/lib/checkout-return";
import {
  ALLOWED_RETURN_TO_ORIGINS,
  isAllowedReturnTo,
} from "../../src/lib/return-to-allowlist";

function redirectTarget(phase: Phase, ctx: CheckoutContext) {
  if (phase !== "succeeded") return null;
  return (
    computeCheckoutSuccessCtas({ phase, ctx }).find((c) => c.id === "primary")
      ?.target ?? null
  );
}

// A pack whose app is registered — so the fallback (no return_to) is the app URL.
const packSku = "epublisher_starter_pack";
// A pass — fallback is `/pricing#passes` (no app URL).
const passSku = "all_access:creator_pass:monthly";

// Pick a real allowlisted spoke origin to build positive cases from.
const allowedOrigin = ALLOWED_RETURN_TO_ORIGINS.find((o) =>
  o.includes("epublisher.reson8.life"),
)!;
const allowedDeepLink = `${allowedOrigin}/library?ref=hub`;
const allowedHubDeepLink = "https://reson8.life/account";

const disallowed: readonly string[] = [
  "https://evil.example.com/phish",
  "https://reson8.life.evil.com/", // suffix trick
  "https://sub.epublisher.reson8.life.attacker.io/", // origin lookalike
  "http://reson8.life/account", // wrong scheme (http vs https)
  "javascript:alert(1)", // not http(s)
  "//reson8.life/account", // protocol-relative — not absolute
  "/account", // relative
  "not a url",
  "",
];

describe("return_to allowlist — sanity", () => {
  it("known spoke origin is allowlisted", () => {
    expect(isAllowedReturnTo(allowedDeepLink)).toBe(true);
  });

  it.each(disallowed)("rejects non-allowlisted candidate: %s", (candidate) => {
    expect(isAllowedReturnTo(candidate)).toBe(false);
  });
});

describe("checkout.success redirect uses return_to ONLY when allowlisted", () => {
  it("allowlisted spoke return_to overrides app-URL fallback (pack)", () => {
    const ctx = resolveCheckoutContext({
      pack: packSku,
      return_to: allowedDeepLink,
    });
    expect(ctx.returnTo).toBe(allowedDeepLink);
    expect(redirectTarget("succeeded", ctx)).toEqual({
      kind: "external",
      href: allowedDeepLink,
    });
  });

  it("allowlisted hub return_to overrides pricing-anchor fallback (pass)", () => {
    const ctx = resolveCheckoutContext({
      sku: passSku,
      return_to: allowedHubDeepLink,
    });
    expect(ctx.returnTo).toBe(allowedHubDeepLink);
    expect(redirectTarget("succeeded", ctx)).toEqual({
      kind: "external",
      href: allowedHubDeepLink,
    });
  });

  it.each(disallowed)(
    "drops non-allowlisted return_to and falls back to pricing anchor (pass): %s",
    (bad) => {
      const ctx = resolveCheckoutContext({ sku: passSku, return_to: bad });
      expect(ctx.returnTo).toBeUndefined();
      expect(redirectTarget("succeeded", ctx)).toEqual({
        kind: "internal",
        to: "/pricing",
        hash: "passes",
      });
    },
  );

  it.each(disallowed)(
    "drops non-allowlisted return_to and falls back to app URL (pack): %s",
    (bad) => {
      const ctx = resolveCheckoutContext({ pack: packSku, return_to: bad });
      expect(ctx.returnTo).toBeUndefined();
      const target = redirectTarget("succeeded", ctx);
      expect(target?.kind).toBe("external");
      // Fallback is the registered app URL, NOT the attacker input.
      if (target?.kind === "external") {
        expect(target.href).not.toBe(bad);
        expect(isAllowedReturnTo(target.href)).toBe(true);
      }
    },
  );

  it("null/undefined return_to → default fallback, no crash", () => {
    const ctx = resolveCheckoutContext({ sku: passSku, return_to: null });
    expect(ctx.returnTo).toBeUndefined();
    expect(redirectTarget("succeeded", ctx)).toEqual({
      kind: "internal",
      to: "/pricing",
      hash: "passes",
    });
  });
});
