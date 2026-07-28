/**
 * Allowlist for post-checkout `return_to` redirects.
 *
 * The Hub's /checkout flow accepts a `return_to` URL that becomes the
 * "Continue to your app" CTA on /checkout/success and /checkout/cancel,
 * and is also passed to PayFast as `return_url` / `cancel_url`.
 *
 * Without an allowlist this is an open-redirect vector — an attacker can
 * craft `/checkout?sku=...&return_to=https://evil.com` and the branded
 * post-payment CTA points to a phishing page.
 *
 * We restrict `return_to` to the canonical origins of known spoke apps
 * (from APP_REGISTRY) plus the Hub itself.
 */

import { APP_REGISTRY } from "./app-registry";

const HUB_ORIGINS = [
  "https://reson8.life",
  "https://www.reson8.life",
  "https://resonance-hub.lovable.app",
];

/**
 * Parse a URL and return its normalized origin, or `null` if it isn't a
 * plain http(s) absolute URL we can safely compare against the allowlist.
 *
 * Rejects:
 *  - non-string / empty input
 *  - unparseable / relative / protocol-relative URLs
 *  - non-http(s) schemes (blocks `javascript:`, `data:`, etc.)
 *  - URLs carrying userinfo (`https://evil.com@reson8.life/…`) — the WHATWG
 *    URL origin ignores userinfo, so without this check an attacker could
 *    smuggle a phishing-friendly display host past the allowlist.
 *  - opaque origins (`"null"`)
 *
 * The WHATWG URL parser already lowercases the host, drops the default
 * port, and decodes percent-encoded host characters, so trailing slashes,
 * uppercase hosts, and `%NN` host encodings are handled by construction.
 */
function safeOrigin(url: string): string | null {
  if (typeof url !== "string" || url.length === 0) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
  if (parsed.username !== "" || parsed.password !== "") return null;
  const origin = parsed.origin;
  if (!origin || origin === "null") return null;
  return origin;
}

export const ALLOWED_RETURN_TO_ORIGINS: readonly string[] = Array.from(
  new Set(
    [
      ...HUB_ORIGINS,
      ...Object.values(APP_REGISTRY).flatMap((a) => [a.url, a.fallbackUrl]),
    ]
      .filter((u): u is string => typeof u === "string" && u.length > 0)
      .map(safeOrigin)
      .filter((o): o is string => o !== null),
  ),
);

/** Returns true if `url` is a parseable absolute http(s) URL, has no userinfo, and whose normalized origin is allowlisted. */
export function isAllowedReturnTo(url: string | undefined | null): boolean {
  if (!url) return false;
  const origin = safeOrigin(url);
  return origin !== null && ALLOWED_RETURN_TO_ORIGINS.includes(origin);
}

/** Returns `url` if allowlisted, otherwise `undefined`. */
export function sanitizeReturnTo(
  url: string | undefined | null,
): string | undefined {
  return isAllowedReturnTo(url) ? (url as string) : undefined;
}
