/**
 * Contract tests for the security headers.
 *
 * These pin the two properties the Hub actually depends on:
 *  - navigation/redirect containment (form-action, base-uri, frame-ancestors,
 *    object-src) so an injected page can't retarget checkout, and
 *  - referrer minimization so `sku`, `pack` and `return_to` never leak to a
 *    cross-origin host.
 */
import { describe, expect, it } from "bun:test";
import {
  buildContentSecurityPolicy,
  buildSecurityHeaders,
  isHtmlResponse,
  withSecurityHeaders,
  TRANSPORT_SECURITY_HEADERS,
} from "../../src/lib/security-headers";

function directives(policy: string): Map<string, string[]> {
  return new Map(
    policy.split(";").map((part) => {
      const [name, ...values] = part.trim().split(/\s+/);
      return [name, values];
    }),
  );
}

const html = (init: ResponseInit = {}) =>
  new Response("<!doctype html><html></html>", {
    headers: { "content-type": "text/html; charset=utf-8" },
    ...init,
  });

describe("CSP — redirect and navigation containment", () => {
  const d = directives(buildContentSecurityPolicy());

  it("restricts form submissions to the Hub and PayFast only", () => {
    expect(d.get("form-action")).toEqual([
      "'self'",
      "https://www.payfast.co.za",
      "https://sandbox.payfast.co.za",
    ]);
    expect(d.get("form-action")).not.toContain("*");
  });

  it("locks base-uri so relative links cannot be rebased off-origin", () => {
    expect(d.get("base-uri")).toEqual(["'self'"]);
  });

  it("frames only Hub domains and the Lovable editor/preview", () => {
    const fa = d.get("frame-ancestors")!;
    expect(fa).toContain("'self'");
    expect(fa).toContain("https://reson8.life");
    expect(fa).toContain("https://*.lovable.app");
    expect(fa).not.toContain("*");
    expect(fa.some((v) => v.includes("evil"))).toBe(false);
  });

  it("blocks plugin and eval based navigation in production", () => {
    expect(d.get("object-src")).toEqual(["'none'"]);
    expect(d.get("script-src")).not.toContain("'unsafe-eval'");
    expect(buildContentSecurityPolicy()).toContain("upgrade-insecure-requests");
  });

  it("has a default-src fallback for every unlisted fetch type", () => {
    expect(d.get("default-src")).toEqual(["'self'"]);
  });

  it("allows the backend over https/wss but no arbitrary host", () => {
    const cs = d.get("connect-src")!;
    expect(cs).toContain("https://*.supabase.co");
    expect(cs).toContain("wss://*.supabase.co");
    expect(cs).not.toContain("*");
  });

  it("only relaxes eval and ws in dev mode", () => {
    const dev = directives(buildContentSecurityPolicy({ dev: true }));
    expect(dev.get("script-src")).toContain("'unsafe-eval'");
    expect(dev.get("connect-src")).toContain("wss:");
    // Navigation containment is identical in dev — it is not a dev-only control.
    expect(dev.get("form-action")).toEqual(d.get("form-action"));
    expect(dev.get("base-uri")).toEqual(d.get("base-uri"));
    expect(buildContentSecurityPolicy({ dev: true })).not.toContain(
      "upgrade-insecure-requests",
    );
  });
});

describe("Referrer-Policy — cross-origin leakage", () => {
  it("sends origin-only cross-origin and nothing on downgrade", () => {
    expect(buildSecurityHeaders()["referrer-policy"]).toBe(
      "strict-origin-when-cross-origin",
    );
    expect(TRANSPORT_SECURITY_HEADERS["referrer-policy"]).toBe(
      "strict-origin-when-cross-origin",
    );
  });

  it("is never a policy that would leak checkout query strings", () => {
    const leaky = ["unsafe-url", "no-referrer-when-downgrade", "origin-when-cross-origin"];
    for (const source of [buildSecurityHeaders(), TRANSPORT_SECURITY_HEADERS]) {
      expect(leaky).not.toContain(source["referrer-policy"]);
    }
  });

  it("severs window.opener for cross-origin popups while keeping OAuth usable", () => {
    expect(buildSecurityHeaders()["cross-origin-opener-policy"]).toBe(
      "same-origin-allow-popups",
    );
  });

  it("sets nosniff so a text response cannot be re-typed as script", () => {
    expect(buildSecurityHeaders()["x-content-type-options"]).toBe("nosniff");
  });
});

describe("withSecurityHeaders", () => {
  it("applies the full policy to HTML documents", () => {
    const res = withSecurityHeaders(html());
    expect(res.headers.get("content-security-policy")).toContain("form-action");
    expect(res.headers.get("referrer-policy")).toBe(
      "strict-origin-when-cross-origin",
    );
    expect(res.headers.get("permissions-policy")).toContain("camera=()");
  });

  it("applies only leakage controls to JSON and asset responses", () => {
    const json = withSecurityHeaders(
      new Response("{}", { headers: { "content-type": "application/json" } }),
    );
    expect(json.headers.get("referrer-policy")).toBe(
      "strict-origin-when-cross-origin",
    );
    expect(json.headers.get("content-security-policy")).toBeNull();
  });

  it("keeps redirect responses navigable and referrer-minimized", () => {
    const redirect = withSecurityHeaders(
      new Response(null, { status: 302, headers: { location: "/pricing" } }),
    );
    expect(redirect.status).toBe(302);
    expect(redirect.headers.get("location")).toBe("/pricing");
    expect(redirect.headers.get("referrer-policy")).toBe(
      "strict-origin-when-cross-origin",
    );
  });

  it("never overrides a header a route deliberately set", () => {
    const res = withSecurityHeaders(
      html({ headers: { "content-type": "text/html", "referrer-policy": "no-referrer" } }),
    );
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
  });

  it("preserves status, statusText and body", async () => {
    const res = withSecurityHeaders(
      new Response("<html>nope</html>", {
        status: 404,
        statusText: "Not Found",
        headers: { "content-type": "text/html" },
      }),
    );
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("<html>nope</html>");
  });

  it("detects HTML by content-type", () => {
    expect(isHtmlResponse(html())).toBe(true);
    expect(isHtmlResponse(new Response("x"))).toBe(false);
  });
});
