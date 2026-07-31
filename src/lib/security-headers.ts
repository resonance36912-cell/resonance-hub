/**
 * Security response headers for the Hub.
 *
 * Two threats drive this file:
 *
 * 1. **Redirect safety.** The Hub accepts a caller-supplied `return_to` and
 *    turns it into post-checkout navigation (see `docs/return-to-allowlist.md`).
 *    The allowlist is the primary control; CSP is defence in depth for the
 *    cases it can't see — injected markup, a third-party script, or a future
 *    code path that forgets to sanitize:
 *      • `form-action`  — a smuggled <form action="https://evil"> can't post
 *                         card details or a session anywhere but the Hub and
 *                         PayFast.
 *      • `base-uri`     — blocks <base href> hijacking of every relative link
 *                         and form on the page.
 *      • `frame-ancestors` — only the Hub, its domains and the Lovable
 *                         editor/preview may frame us, so a phishing site
 *                         can't wrap checkout in its own chrome.
 *      • `object-src 'none'` — no plugin-driven navigation.
 *
 * 2. **Cross-origin leakage.** Checkout URLs carry `sku`, `pack`, `return_to`
 *    and PayFast identifiers in the query string. `Referrer-Policy:
 *    strict-origin-when-cross-origin` means outbound requests to spokes,
 *    PayFast, fonts, or an attacker's host receive only `https://reson8.life`
 *    — never the path or query. Same-origin requests keep the full URL, so
 *    internal analytics still work.
 *
 * The audit log stores origins only for the same reason (see
 * `src/lib/return-to-audit.ts`); these headers stop the browser from
 * volunteering what we deliberately don't record.
 *
 * CSP notes:
 *  - `script-src` needs `'unsafe-inline'`: TanStack Start emits inline
 *    hydration/serialization scripts, and this runtime has no per-request
 *    nonce plumbing. Everything else is locked down, so this is not a
 *    licence to relax the navigation directives above.
 *  - Dev additionally needs `'unsafe-eval'` and websocket `connect-src`
 *    for Vite HMR.
 */

/** Origins allowed to frame the Hub (own domains + Lovable editor/preview). */
const FRAME_ANCESTORS = [
  "'self'",
  "https://reson8.life",
  "https://www.reson8.life",
  "https://*.lovable.app",
  "https://lovable.dev",
  "https://*.lovable.dev",
  "https://lovableproject.com",
  "https://*.lovableproject.com",
] as const;

/** Where the browser may submit a form: the Hub itself and PayFast. */
const FORM_ACTION = [
  "'self'",
  "https://www.payfast.co.za",
  "https://sandbox.payfast.co.za",
] as const;

/** XHR/fetch/websocket destinations: same-origin plus the backend. */
const CONNECT_SRC = [
  "'self'",
  "https://*.supabase.co",
  "wss://*.supabase.co",
] as const;

export type SecurityHeaderOptions = {
  /** Relax CSP for Vite HMR (eval + ws). Never enable in production. */
  dev?: boolean;
};

/** Build the Content-Security-Policy header value. */
export function buildContentSecurityPolicy(
  options: SecurityHeaderOptions = {},
): string {
  const scriptSrc: string[] = ["'self'", "'unsafe-inline'"];
  const connectSrc: string[] = [...CONNECT_SRC];

  if (options.dev) {
    scriptSrc.push("'unsafe-eval'");
    connectSrc.push("ws:", "wss:", "http://localhost:*");
  }

  const directives: [string, string[]][] = [
    ["default-src", ["'self'"]],
    ["script-src", scriptSrc],
    ["style-src", ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"]],
    ["font-src", ["'self'", "https://fonts.gstatic.com", "data:"]],
    ["img-src", ["'self'", "data:", "blob:", "https:"]],
    ["connect-src", connectSrc],
    // Redirect-safety directives.
    ["form-action", [...FORM_ACTION]],
    ["frame-ancestors", [...FRAME_ANCESTORS]],
    ["base-uri", ["'self'"]],
    ["object-src", ["'none'"]],
    ["frame-src", ["'self'"]],
    ["worker-src", ["'self'", "blob:"]],
    ["manifest-src", ["'self'"]],
  ];

  const policy = directives
    .map(([name, values]) => `${name} ${values.join(" ")}`)
    .join("; ");

  // Upgrade mixed content in production only (dev serves plain http).
  return options.dev ? policy : `${policy}; upgrade-insecure-requests`;
}

/**
 * Full security header set applied to HTML document responses.
 * Non-document responses (JSON, assets, RPC) get the subset in
 * `TRANSPORT_SECURITY_HEADERS`.
 */
export function buildSecurityHeaders(
  options: SecurityHeaderOptions = {},
): Record<string, string> {
  return {
    "content-security-policy": buildContentSecurityPolicy(options),
    // Cross-origin navigations and subresources see the origin only, and
    // https→http downgrades see nothing at all.
    "referrer-policy": "strict-origin-when-cross-origin",
    "x-content-type-options": "nosniff",
    // allow-popups keeps OAuth popup flows working while severing the
    // window.opener reference an injected page would need.
    "cross-origin-opener-policy": "same-origin-allow-popups",
    "permissions-policy":
      "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  };
}

/**
 * Headers safe for every response, including JSON APIs and static assets.
 * CSP document directives are omitted; leakage controls are not.
 */
export const TRANSPORT_SECURITY_HEADERS: Record<string, string> = {
  "referrer-policy": "strict-origin-when-cross-origin",
  "x-content-type-options": "nosniff",
};

/** True when the response body is an HTML document. */
export function isHtmlResponse(response: Response): boolean {
  return (response.headers.get("content-type") ?? "").includes("text/html");
}

/**
 * Apply security headers to a response without clobbering values a route
 * deliberately set (e.g. an embeddable widget loosening frame-ancestors).
 * Redirects (3xx) and asset responses only receive the transport subset.
 */
export function withSecurityHeaders(
  response: Response,
  options: SecurityHeaderOptions = {},
): Response {
  const applicable = isHtmlResponse(response)
    ? buildSecurityHeaders(options)
    : TRANSPORT_SECURITY_HEADERS;

  let mutated = false;
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(applicable)) {
    if (headers.has(name)) continue;
    headers.set(name, value);
    mutated = true;
  }
  if (!mutated) return response;

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
