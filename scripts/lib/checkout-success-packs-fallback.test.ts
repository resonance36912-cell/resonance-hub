/**
 * Regression contract: for EVERY pack in PACK_CATALOG, a non-allowlisted
 * `return_to` must be dropped and the `succeeded` auto-redirect target must
 * equal the canonical default for that pack — NOT any value derived from
 * the attacker input.
 *
 * Canonical default per pack:
 *   • If the pack's app is in APP_REGISTRY  → { external, href: app.url }.
 *   • Otherwise                              → { internal, /pricing#packs }.
 *
 * This pins the fallback exactly, so a future refactor cannot silently
 * replace the app URL with e.g. `return_to`'s origin, a `return_to`
 * pathname grafted onto the app origin, or `/pricing` for a pack whose
 * app IS registered.
 */
import { describe, expect, it } from "bun:test";
import {
  computeCheckoutSuccessCtas,
  type CtaTarget,
} from "../../src/lib/checkout-success-ctas";
import { resolveCheckoutContext } from "../../src/lib/checkout-return";
import { PACK_CATALOG } from "../../src/lib/checkout.functions";
import { getAppEntry } from "../../src/lib/app-registry";
import { isAllowedReturnTo } from "../../src/lib/return-to-allowlist";

function successPrimaryTarget(packId: string, return_to: string | null): CtaTarget | null {
  const ctx = resolveCheckoutContext({ pack: packId, return_to });
  return (
    computeCheckoutSuccessCtas({ phase: "succeeded", ctx }).find(
      (c) => c.id === "primary",
    )?.target ?? null
  );
}

function expectedDefault(packId: string): CtaTarget {
  const pack = PACK_CATALOG[packId];
  const app = pack?.app ? getAppEntry(pack.app) : null;
  return app
    ? { kind: "external", href: app.url }
    : { kind: "internal", to: "/pricing", hash: "packs" };
}

const DISALLOWED: readonly string[] = [
  "https://evil.example.com/phish",
  "https://reson8.life.evil.com/",
  "https://sub.resonanceonline.life.attacker.io/",
  "http://reson8.life/account", // wrong scheme
  "javascript:alert(1)",
  "//reson8.life/account",
  "/account",
  "not a url",
  "",
  // Attacker path grafts that historically tricked naive fallbacks:
  "https://evil.example/?next=https://www.creativestudio.life/welcome",
  "https://www.creativestudio.life.evil.io/welcome",
];

const PACK_IDS = Object.keys(PACK_CATALOG);

describe("packs — non-allowlisted return_to falls back to canonical default", () => {
  it("PACK_CATALOG is non-empty (guard against silent regressions)", () => {
    expect(PACK_IDS.length).toBeGreaterThan(0);
  });

  for (const packId of PACK_IDS) {
    const expected = expectedDefault(packId);

    it(`${packId} — no return_to → canonical default`, () => {
      expect(successPrimaryTarget(packId, null)).toEqual(expected);
    });

    for (const bad of DISALLOWED) {
      it(`${packId} — rejects return_to=${JSON.stringify(bad)} → canonical default`, () => {
        // Precondition: the candidate really is non-allowlisted.
        expect(isAllowedReturnTo(bad)).toBe(false);

        const target = successPrimaryTarget(packId, bad);
        expect(target).toEqual(expected);

        // Extra belt-and-braces: nothing derived from `bad` may leak through.
        if (target?.kind === "external") {
          expect(target.href).not.toBe(bad);
          expect(target.href).not.toContain("evil");
          expect(isAllowedReturnTo(target.href)).toBe(true);
        }
      });
    }
  }
});
