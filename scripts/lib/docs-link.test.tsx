/**
 * Unit tests for `<DocsLink>` in `src/components/DocsLink.tsx`.
 *
 * DocsLink is a thin dispatcher: internal targets delegate to `AppLink`
 * (typed `RoutePath`, no `target="_blank"`); external `http(s)://` targets
 * render a raw `<a>` with `target="_blank"` and `rel="noreferrer noopener"`.
 *
 * We inspect the returned React element directly instead of mounting into a
 * DOM — AppLink is a TanStack `createLink` component that requires a
 * RouterProvider, and the contract we care about is entirely visible on the
 * returned element's `type` and `props`.
 */
import { describe, expect, it } from "bun:test";
import { isValidElement } from "react";
import { DocsLink } from "../../src/components/DocsLink";
import { AppLink } from "../../src/components/AppLink";
import { ROUTES } from "../../src/lib/routes";

describe("<DocsLink> internal (RoutePath) branch", () => {
  it("delegates to <AppLink> and does not set target/rel", () => {
    const el = DocsLink({ to: ROUTES.docs, children: "Docs", className: "underline" }) as any;
    expect(isValidElement(el)).toBe(true);
    expect(el.type).toBe(AppLink);
    expect(el.props.to).toBe(ROUTES.docs);
    expect(el.props.className).toBe("underline");
    // Critical: no new-tab escape hatch on internal links.
    expect(el.props.target).toBeUndefined();
    expect(el.props.rel).toBeUndefined();
  });

  it("forwards params and search to AppLink for dynamic routes", () => {
    const el = DocsLink({
      to: "/account/invoices/$id",
      params: { id: "inv_1" },
      search: undefined,
      children: "Invoice",
    }) as any;
    expect(el.type).toBe(AppLink);
    expect(el.props.params).toEqual({ id: "inv_1" });
  });

  it("compile-time: rejects unregistered internal paths", () => {
    // @ts-expect-error — "/auth" is not a registered route
    <DocsLink to="/auth">Login</DocsLink>;
    // @ts-expect-error — arbitrary unknown route
    <DocsLink to="/not-a-real-route">Nope</DocsLink>;
    // @ts-expect-error — bare-path strings must go through `to`, not `href`
    <DocsLink href="/pricing">Bad</DocsLink>;
    expect(true).toBe(true);
  });
});

describe("<DocsLink> external (http/https) branch", () => {
  it("renders a raw <a> with target=_blank and rel=noreferrer noopener", () => {
    const el = DocsLink({
      href: "https://github.com/resonance36912-cell/RCGF",
      children: "RCGF",
      className: "underline",
    }) as any;
    expect(isValidElement(el)).toBe(true);
    expect(el.type).toBe("a");
    expect(el.props.href).toBe("https://github.com/resonance36912-cell/RCGF");
    expect(el.props.target).toBe("_blank");
    expect(el.props.rel).toBe("noreferrer noopener");
    expect(el.props.className).toBe("underline");
  });

  it("accepts plain http:// as well as https://", () => {
    const el = DocsLink({ href: "http://example.com/spec", children: "Spec" }) as any;
    expect(el.type).toBe("a");
    expect(el.props.href).toBe("http://example.com/spec");
    expect(el.props.target).toBe("_blank");
    expect(el.props.rel).toBe("noreferrer noopener");
  });

  it("compile-time: rejects non-http(s) hrefs and mixed prop shapes", () => {
    // @ts-expect-error — mailto is not http(s)://
    <DocsLink href="mailto:hello@reson8.life">Email</DocsLink>;
    // @ts-expect-error — protocol-relative is not allowed
    <DocsLink href="//example.com">Bad</DocsLink>;
    // @ts-expect-error — cannot pass both `to` and `href`
    <DocsLink to={ROUTES.docs} href="https://example.com">Both</DocsLink>;
    expect(true).toBe(true);
  });
});
