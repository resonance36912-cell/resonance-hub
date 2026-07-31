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
 *
 * Full contract — accept/reject rules, normalization behavior, and
 * enforcement points — is documented in `docs/return-to-allowlist.md`.
 * Any change to `safeOrigin` MUST be mirrored there and in the tests
 * under `scripts/lib/return-to-allowlist-*.test.ts`.
 *
 * Accept summary (origin-only, on the parser-normalized `.origin`):
 *   • scheme ∈ { https:, http: }
 *   • userinfo is empty (WHATWG `.origin` ignores userinfo; we reject
 *     on the presence of `username`/`password` to block smuggling like
 *     `https://evil.com@reson8.life/`)
 *   • origin ∈ ALLOWED_RETURN_TO_ORIGINS (Hub + spoke `url`/`fallbackUrl`)
 *
 * The WHATWG parser handles these normalizations before comparison, so
 * they are accepted transparently: trailing slash / arbitrary path /
 * query / fragment, uppercase or mixed-case host, uppercase scheme,
 * explicit default port (`:443` on https), percent-encoded ASCII host
 * chars (`reson%38.life` ≡ `reson8.life`), and any percent-encoding in
 * the path/query (origin is unaffected).
 *
 * Reject summary: `null`/`undefined`/empty/non-string; unparseable,
 * relative, or protocol-relative URLs; non-http(s) schemes
 * (`javascript:`, `data:`, `file:`, `ftp:`, `vbscript:`, …); any URL
 * carrying userinfo (including percent-encoded); opaque origins
 * (`"null"`); trailing-dot hosts; suffix TLD grafts; non-allowlisted
 * subdomains; homoglyph hosts; wrong TLD; non-default ports on an
 * allowlisted host; protocol swap/downgrade.
 *
 * `sanitizeReturnTo` returns the exact caller-provided string when
 * accepted (never a mutated/normalized form) so downstream consumers
 * keep the caller's path, query, and fragment intact.
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

/**
 * Admin-managed extra origins, layered on top of the code-defined
 * `ALLOWED_RETURN_TO_ORIGINS` at runtime.
 *
 * These come from `public.return_to_origins` (enabled rows only) and are
 * registered by `hydrateReturnToAllowlist()` from
 * `src/lib/return-to-allowlist.functions.ts`. The static base list is never
 * mutated, so an admin can only ever *widen* the allowlist, never remove a
 * canonical Hub/spoke origin.
 */
const extraOrigins = new Set<string>();

/**
 * Register admin-managed origins. Values are normalized through `safeOrigin`
 * and silently dropped when they aren't plain http(s) origins.
 * Returns the normalized origins that were accepted.
 */
export function registerExtraReturnToOrigins(
  origins: readonly (string | null | undefined)[],
): string[] {
  const accepted: string[] = [];
  for (const raw of origins) {
    if (typeof raw !== "string") continue;
    const origin = safeOrigin(raw);
    if (!origin) continue;
    extraOrigins.add(origin);
    accepted.push(origin);
  }
  return accepted;
}

/** Drop all admin-managed extras (used by tests and by re-hydration). */
export function clearExtraReturnToOrigins(): void {
  extraOrigins.clear();
}

/** Admin-managed extras currently registered (normalized origins). */
export function getExtraReturnToOrigins(): string[] {
  return Array.from(extraOrigins);
}

/** Effective allowlist: code-defined base ∪ admin-managed extras. */
export function getAllowedReturnToOrigins(): string[] {
  return Array.from(new Set([...ALLOWED_RETURN_TO_ORIGINS, ...extraOrigins]));
}

/** Returns true if `url` is a parseable absolute http(s) URL, has no userinfo, and whose normalized origin is allowlisted. */
export function isAllowedReturnTo(url: string | undefined | null): boolean {
  if (!url) return false;
  const origin = safeOrigin(url);
  if (origin === null) return false;
  return ALLOWED_RETURN_TO_ORIGINS.includes(origin) || extraOrigins.has(origin);
}

/** Returns `url` if allowlisted, otherwise `undefined`. */
export function sanitizeReturnTo(
  url: string | undefined | null,
): string | undefined {
  return isAllowedReturnTo(url) ? (url as string) : undefined;
}

export type ReturnToVerdict = {
  input: string;
  allowed: boolean;
  /** Normalized origin when the URL parsed as a plain http(s) URL. */
  origin: string | null;
  /** Machine-readable reason code. */
  code:
    | "allowed_base"
    | "allowed_extra"
    | "empty"
    | "unparseable"
    | "bad_scheme"
    | "userinfo"
    | "opaque_origin"
    | "origin_not_allowlisted";
  /** Human-readable explanation for the admin preview. */
  reason: string;
};

/**
 * Explain — rather than just decide — whether a candidate `return_to` would be
 * accepted. Powers the live preview on `/admin/return-to-allowlist`.
 *
 * `extras` defaults to the currently registered admin-managed origins, but the
 * admin UI passes the DB list directly so the preview reflects unsaved/just-saved
 * rows without needing a re-hydration round trip.
 */
export function explainReturnTo(
  input: string | null | undefined,
  extras: readonly string[] = getExtraReturnToOrigins(),
): ReturnToVerdict {
  const value = typeof input === "string" ? input : "";
  const base = { input: value, allowed: false, origin: null } as const;

  if (value.trim().length === 0) {
    return { ...base, code: "empty", reason: "Empty value — rejected." };
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return {
      ...base,
      code: "unparseable",
      reason:
        "Not an absolute URL (relative and protocol-relative values are rejected).",
    };
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return {
      ...base,
      code: "bad_scheme",
      reason: `Scheme "${parsed.protocol}" is not http(s).`,
    };
  }

  if (parsed.username !== "" || parsed.password !== "") {
    return {
      ...base,
      code: "userinfo",
      reason:
        "URL carries userinfo (user:pass@host) — rejected to block display-host smuggling.",
    };
  }

  const origin = parsed.origin;
  if (!origin || origin === "null") {
    return { ...base, code: "opaque_origin", reason: "Opaque origin." };
  }

  if (ALLOWED_RETURN_TO_ORIGINS.includes(origin)) {
    return {
      input: value,
      allowed: true,
      origin,
      code: "allowed_base",
      reason: "Origin is a built-in Hub/spoke origin.",
    };
  }

  const normalizedExtras = new Set(
    extras
      .map((e) => safeOrigin(e))
      .filter((o): o is string => o !== null),
  );
  if (normalizedExtras.has(origin)) {
    return {
      input: value,
      allowed: true,
      origin,
      code: "allowed_extra",
      reason: "Origin is an admin-managed allowlist entry.",
    };
  }

  return {
    input: value,
    allowed: false,
    origin,
    code: "origin_not_allowlisted",
    reason: `Origin ${origin} is not on the allowlist.`,
  };
}

