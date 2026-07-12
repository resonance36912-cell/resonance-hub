/**
 * Unit tests for `<AppLink>` in `src/components/AppLink.tsx`.
 *
 * `AppLink` is `createLink(AnchorHost)` from TanStack Router. All of its
 * forwarding behaviour (params interpolation, search serialization, `from`
 * resolution, active-state handling, preloading) is implemented and covered
 * inside `@tanstack/react-router` itself — re-testing it at runtime would
 * require a full RouterProvider + happy-dom + testing-library stack for
 * behaviour the library already guarantees.
 *
 * What THIS repo needs to guard is the wrapper's contract:
 *   1. `AppLink` is a real React component exported from the module.
 *   2. `to` is narrowed to `RoutePath` (the registered route union) so
 *      invalid paths like `"/auth"` are a compile error at the call site.
 *   3. `params` is required and type-checked for dynamic routes; extra keys
 *      and missing keys both fail typecheck.
 *   4. `search` and `from` are accepted and typed against the route.
 *
 * Points 2–4 are enforced with `@ts-expect-error` — if a future change ever
 * widens the prop types, `tsc --noEmit` (run in CI) turns each unused
 * directive into a build failure.
 */
import { describe, expect, it } from "bun:test";
import { AppLink, RawLink } from "../../src/components/AppLink";
import { ROUTES } from "../../src/lib/routes";

describe("<AppLink> module contract", () => {
  it("exports AppLink as a component", () => {
    expect(AppLink).toBeDefined();
    // `createLink` returns a component (function or forwardRef object).
    const t = typeof AppLink;
    expect(t === "function" || t === "object").toBe(true);
  });

  it("exports the raw TanStack Link as an escape hatch", () => {
    expect(RawLink).toBeDefined();
  });
});

describe("<AppLink> prop typing (compile-time guards)", () => {
  it("accepts valid static routes from ROUTES", () => {
    // These render calls exist purely so TypeScript sees the JSX and
    // exercises `to` inference. They are never mounted.
    const _valid = (
      <>
        <AppLink to={ROUTES.home}>Home</AppLink>
        <AppLink to={ROUTES.pricing}>Pricing</AppLink>
        <AppLink to="/pricing">Pricing (literal)</AppLink>
        <AppLink to="/account/billing">Billing</AppLink>
      </>
    );
    expect(_valid).toBeDefined();
  });

  it("forwards params for dynamic routes and enforces param shape", () => {
    const _dynamic = (
      <>
        {/* Valid — dynamic route with required `id` param. */}
        <AppLink to="/apps/submissions/$id" params={{ id: "abc" }}>
          Submission
        </AppLink>
        {/* Valid — invoice detail by $id. */}
        <AppLink to="/account/invoices/$id" params={{ id: "inv_1" }}>
          Invoice
        </AppLink>
      </>
    );
    expect(_dynamic).toBeDefined();

    // @ts-expect-error — missing required `id` param for a dynamic route
    <AppLink to="/apps/submissions/$id">Missing param</AppLink>;
    // @ts-expect-error — wrong param key (typo)
    <AppLink to="/apps/submissions/$id" params={{ wrongKey: "x" }}>x</AppLink>;
  });

  it("forwards search and `from` with route-scoped typing", () => {
    // `search` on `/login` is validated by the route's `validateSearch`.
    const _withSearch = (
      <AppLink to="/login" search={{ next: "/account/billing" }}>
        Sign in
      </AppLink>
    );
    expect(_withSearch).toBeDefined();

    // `from` narrows relative-path typing.
    const _withFrom = (
      <AppLink from="/account/billing" to=".">
        Reload
      </AppLink>
    );
    expect(_withFrom).toBeDefined();
  });

  it("rejects invalid route paths at the type level", () => {
    // @ts-expect-error — "/auth" is not a registered route (regression guard)
    <AppLink to="/auth">Login</AppLink>;
    // @ts-expect-error — arbitrary unknown route string
    <AppLink to="/definitely-not-a-route">Nope</AppLink>;
    // @ts-expect-error — typo of a real route
    <AppLink to="/pricin">Typo</AppLink>;
    // @ts-expect-error — bare `string` (not a literal) is not narrowable
    <AppLink to={"/pricing" as string}>Widened</AppLink>;
    // @ts-expect-error — `from` must also be a registered route
    <AppLink from="/not-a-real-route" to=".">Bad from</AppLink>;

    expect(true).toBe(true);
  });
});
