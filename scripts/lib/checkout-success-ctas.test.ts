/**
 * Full phase coverage for `/checkout/success` CTA rendering.
 *
 * Guards two invariants for every Phase value:
 *   1. Non-terminal phases (`verifying`, `pending`) render EXACTLY ONE CTA
 *      — the primary "View subscriptions" / "See more packs" link. This is
 *      the direct regression test for the duplicate-button bug.
 *   2. Terminal phases (`succeeded`, `skip`, `failed`, `cancelled`,
 *      `refunded`) render EXACTLY ONE bordered secondary CTA whose label
 *      matches the kind-aware secondary target, plus a single primary.
 *
 * Runs as `bun test scripts/lib/checkout-success-ctas.test.ts`.
 */
import { describe, expect, it } from "bun:test";
import {
  TERMINAL_PHASES,
  computeCheckoutSuccessCtas,
  resolveSecondaryTarget,
  type Phase,
} from "../../src/lib/checkout-success-ctas";
import { resolveCheckoutContext } from "../../src/lib/checkout-return";

const ALL_PHASES: readonly Phase[] = [
  "verifying",
  "pending",
  "succeeded",
  "skip",
  "failed",
  "cancelled",
  "refunded",
];

const NON_TERMINAL: readonly Phase[] = ["verifying", "pending"];

// A pass sku exercises the "View subscriptions" secondary label.
const passCtx = resolveCheckoutContext({
  sku: "all_access:creator_pass:monthly",
});
// A pack exercises the "See more packs" secondary label.
const packCtx = resolveCheckoutContext({ pack: "epublisher_starter_pack" });
// An unknown SKU exercises the fallback ("See more packs"/"See ecosystem passes").
const unknownCtx = resolveCheckoutContext({ sku: "bogus:not_a_sku" });

describe("computeCheckoutSuccessCtas — no phase produces duplicate secondary", () => {
  for (const ctx of [passCtx, packCtx, unknownCtx]) {
    const secondaryLabel = resolveSecondaryTarget(ctx).label;

    for (const phase of ALL_PHASES) {
      it(`phase=${phase} (${secondaryLabel}) renders no duplicate secondary label`, () => {
        const ctas = computeCheckoutSuccessCtas({ phase, ctx });
        const matching = ctas.filter((c) => c.label === secondaryLabel);
        expect(matching.length).toBeLessThanOrEqual(1);
      });
    }
  }
});

describe("computeCheckoutSuccessCtas — non-terminal phases render exactly one CTA", () => {
  for (const phase of NON_TERMINAL) {
    it(`phase=${phase} (pass) → 1 CTA, label = "View subscriptions"`, () => {
      const ctas = computeCheckoutSuccessCtas({ phase, ctx: passCtx });
      expect(ctas).toHaveLength(1);
      expect(ctas[0].id).toBe("primary");
      expect(ctas[0].variant).toBe("gradient");
      expect(ctas[0].label).toBe("View subscriptions");
      expect(ctas[0].target).toEqual({
        kind: "internal",
        to: "/account/subscriptions",
        hash: undefined,
      });
    });

    it(`phase=${phase} (pack) → 1 CTA, label = "See more packs"`, () => {
      const ctas = computeCheckoutSuccessCtas({ phase, ctx: packCtx });
      expect(ctas).toHaveLength(1);
      expect(ctas[0].id).toBe("primary");
      expect(ctas[0].label).toBe("See more packs");
      expect(ctas[0].target).toEqual({
        kind: "internal",
        to: "/pricing",
        hash: "packs",
      });
    });
  }
});

describe("computeCheckoutSuccessCtas — terminal phases render primary + bordered secondary", () => {
  for (const phase of TERMINAL_PHASES) {
    it(`phase=${phase} (pass) → primary + single bordered "View subscriptions"`, () => {
      const ctas = computeCheckoutSuccessCtas({ phase, ctx: passCtx });
      expect(ctas).toHaveLength(2);

      const [primary, secondary] = ctas;
      expect(primary.id).toBe("primary");
      expect(primary.variant).toBe("gradient");

      expect(secondary.id).toBe("secondary");
      expect(secondary.variant).toBe("outline");
      expect(secondary.label).toBe("View subscriptions");
      expect(secondary.target).toEqual({
        kind: "internal",
        to: "/account/subscriptions",
        hash: undefined,
      });

      // Exactly one CTA carries the secondary label — no duplicate.
      const dupes = ctas.filter((c) => c.label === "View subscriptions");
      expect(dupes).toHaveLength(1);
    });
  }
});

describe("computeCheckoutSuccessCtas — phase-specific primary labels", () => {
  it("succeeded (pass) primary label continues to the app", () => {
    const [primary] = computeCheckoutSuccessCtas({ phase: "succeeded", ctx: passCtx });
    // all_access has no per-app entry, so primary falls back to the pricing anchor label.
    expect(primary.label).toMatch(/(Continue to|See ecosystem passes|See more packs)/);
  });

  it("skip (pack) primary label continues to pack app or pricing anchor", () => {
    const [primary] = computeCheckoutSuccessCtas({ phase: "skip", ctx: packCtx });
    expect(primary.label).toMatch(/(Continue to|See more packs)/);
  });

  for (const phase of ["failed", "cancelled", "refunded"] as const) {
    it(`${phase} primary label = "Back to pricing"`, () => {
      const [primary] = computeCheckoutSuccessCtas({ phase, ctx: passCtx });
      expect(primary.label).toBe("Back to pricing");
      expect(primary.target).toEqual({
        kind: "internal",
        to: "/pricing",
        hash: "passes",
      });
    });
  }
});

describe("resolveSecondaryTarget", () => {
  it("passes get the account subscriptions link", () => {
    expect(resolveSecondaryTarget(passCtx)).toEqual({
      to: "/account/subscriptions",
      hash: undefined,
      label: "View subscriptions",
    });
  });

  it("packs get the packs anchor link", () => {
    expect(resolveSecondaryTarget(packCtx)).toEqual({
      to: "/pricing",
      hash: "packs",
      label: "See more packs",
    });
  });
});
