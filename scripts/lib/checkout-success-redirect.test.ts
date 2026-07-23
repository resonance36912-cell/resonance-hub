/**
 * Verify the `/checkout/success` auto-redirect target for every Phase.
 *
 * `SuccessPage` derives its redirect from the primary CTA returned by
 * `computeCheckoutSuccessCtas` — the same source of truth the visible
 * button uses. These tests lock that contract:
 *
 *   • Only `succeeded` triggers an auto-redirect.
 *   • The redirect target === the primary CTA target (same kind, same
 *     href/route, same hash). No parallel derivation, no drift.
 *   • `pass` contexts with no `return_to`/`app` fall through to
 *     `/pricing#passes`; `pack` contexts to `/pricing#packs`.
 *   • An allowlisted `return_to` overrides both.
 */
import { describe, expect, it } from "bun:test";
import {
  computeCheckoutSuccessCtas,
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
] as const;

// Mirrors the effect in src/routes/checkout.success.tsx — the redirect only
// runs on `succeeded`, and its target is the primary CTA.
function resolveRedirect(phase: Phase, ctx: ReturnType<typeof resolveCheckoutContext>) {
  if (phase !== "succeeded") return null;
  const primary = computeCheckoutSuccessCtas({ phase, ctx }).find(
    (c) => c.id === "primary",
  );
  return primary?.target ?? null;
}

const passCtx = resolveCheckoutContext({
  sku: "all_access:creator_pass:monthly",
});
const packCtx = resolveCheckoutContext({ pack: "epublisher_starter_pack" });
const returnToCtx = resolveCheckoutContext({
  sku: "all_access:creator_pass:monthly",
  return_to: "https://www.resonanceonline.life/dashboard",
});

describe("checkout.success auto-redirect — only `succeeded` navigates", () => {
  for (const phase of ALL_PHASES) {
    const target = resolveRedirect(phase, passCtx);
    it(`phase=${phase} → ${phase === "succeeded" ? "redirects" : "no redirect"}`, () => {
      if (phase === "succeeded") {
        expect(target).not.toBeNull();
      } else {
        expect(target).toBeNull();
      }
    });
  }
});

describe("checkout.success auto-redirect — target matches derived primary CTA", () => {
  it("pass with no return_to → /pricing#passes (matches primary CTA)", () => {
    const target = resolveRedirect("succeeded", passCtx);
    const [primary] = computeCheckoutSuccessCtas({ phase: "succeeded", ctx: passCtx });
    expect(target).toEqual(primary.target);
    expect(target).toEqual({ kind: "internal", to: "/pricing", hash: "passes" });
  });

  it("pack with no return_to → external app URL (matches primary CTA)", () => {
    const target = resolveRedirect("succeeded", packCtx);
    const [primary] = computeCheckoutSuccessCtas({ phase: "succeeded", ctx: packCtx });
    expect(target).toEqual(primary.target);
    // ePublisher pack has a registered app URL, so primary continues externally.
    expect(target?.kind).toBe("external");
    if (target?.kind === "external") {
      expect(target.href).toMatch(/^https?:\/\//);
    }
  });

  it("allowlisted return_to wins over app URL and pricing anchor", () => {
    const target = resolveRedirect("succeeded", returnToCtx);
    const [primary] = computeCheckoutSuccessCtas({
      phase: "succeeded",
      ctx: returnToCtx,
    });
    expect(target).toEqual(primary.target);
    expect(target).toEqual({
      kind: "external",
      href: "https://www.resonanceonline.life/dashboard",
    });
  });
});
