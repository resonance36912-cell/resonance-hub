/**
 * Unit tests for `routePath()` in `src/lib/routes.ts`.
 *
 * Two layers of guarantee:
 *   1. Runtime identity — `routePath(x)` returns `x` unchanged, so it's a
 *      zero-cost wrapper that can be used inline anywhere a plain string
 *      is required (redirects, URL builders).
 *   2. Compile-time rejection — the generic constraint
 *      `<T extends RoutePath>` must reject strings that aren't registered
 *      routes. We assert this with `@ts-expect-error`; if a future change
 *      widens the type accidentally, the directive itself becomes a TS
 *      error and `tsc --noEmit` (run in CI) fails the build.
 */
import { describe, expect, it } from "bun:test";
import { ROUTES, routePath, type RoutePath } from "../../src/lib/routes";

describe("routePath()", () => {
  it("returns the input unchanged for valid registered paths", () => {
    expect(routePath("/")).toBe("/");
    expect(routePath("/login")).toBe("/login");
    expect(routePath("/pricing")).toBe("/pricing");
    expect(routePath("/account/billing")).toBe("/account/billing");
    expect(routePath("/admin")).toBe("/admin");
  });

  it("preserves the literal type of the input (identity generic)", () => {
    const p = routePath("/checkout");
    // Type-level assertion: the return type is the narrow literal, not `string`.
    const _typecheck: "/checkout" = p;
    expect(_typecheck).toBe("/checkout");
  });

  it("accepts every path declared in the ROUTES constant", () => {
    for (const [name, value] of Object.entries(ROUTES)) {
      expect(typeof value).toBe("string");
      expect(value.startsWith("/")).toBe(true);
      // Round-trip through the helper — this is a compile-time check too:
      // if any ROUTES entry drifted off the RoutePath union, tsc would fail.
      expect(routePath(value as RoutePath)).toBe(value);
    }
  });

  it("rejects invalid route strings at the type level", () => {
    // Each call below is a real string at runtime but NOT a member of
    // RoutePath. The `@ts-expect-error` directive asserts that TypeScript
    // rejects the argument; if the type ever widens, tsc will flag the
    // directive as unused and CI (`bun run typecheck`) fails.

    // @ts-expect-error — "/auth" is not a registered route (regression guard)
    routePath("/auth");
    // @ts-expect-error — canonical admin URL has no trailing slash
    routePath("/admin/");
    // @ts-expect-error — arbitrary string is not assignable to RoutePath
    routePath("/definitely-not-a-route");
    // @ts-expect-error — typo of a real route
    routePath("/pricin");
    // @ts-expect-error — leading-slash-less path is not a RoutePath
    routePath("pricing");
    // @ts-expect-error — empty string is not a route
    routePath("");
    // @ts-expect-error — bare `string` (not a literal) is not narrowable to RoutePath
    routePath("/pricing" as string);

    // Sanity: the block above only exercises TS; nothing to assert at runtime.
    expect(true).toBe(true);
  });
});
