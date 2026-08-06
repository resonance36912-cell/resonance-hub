/**
 * Human-readable diagnostics for rejected `return_to` values.
 *
 * Two consumers:
 *   • Server logs — `logReturnToRejection()` writes a single-line
 *     `[return_to] …` warning from loaders and from the PayFast launch server
 *     functions, so "why did my admin-added URL not work?" is answerable from
 *     the server log alone.
 *   • The post-checkout pages — `<ReturnToRejectedNotice />` renders the same
 *     explanation in the UI (visible debug) instead of silently falling back
 *     to /pricing.
 *
 * PRIVACY: only the normalized **origin** of the candidate is ever logged or
 * displayed. Path, query, and fragment are dropped, matching the contract in
 * `src/lib/return-to-audit.ts`. When the value cannot be parsed as a plain
 * http(s) URL there is no origin to show, so we report the reason code only
 * and never echo the raw string.
 */

import {
  ALLOWED_RETURN_TO_ORIGINS,
  explainReturnTo,
  getExtraReturnToOrigins,
  type ReturnToVerdict,
} from "./return-to-allowlist";
import type { ReturnToAuditSurface } from "./return-to-audit";

export type ReturnToDiagnostic = {
  verdict: ReturnToVerdict;
  /** True when a value was supplied and refused (the case worth surfacing). */
  rejected: boolean;
  /** Normalized origin, or null when the value never parsed. */
  origin: string | null;
  /** Short headline for the UI notice. */
  headline: string;
  /** One-sentence explanation of which check failed. */
  detail: string;
  /** Did the origin match the code-defined base allowlist? */
  matchedBaseAllowlist: boolean;
  /** Did the origin match an admin-managed (database) allowlist entry? */
  matchedAdminAllowlist: boolean;
  /** Sizes of each list that was consulted, for "was the DB list empty?" triage. */
  baseAllowlistCount: number;
  adminAllowlistCount: number;
};

/**
 * Explain a candidate `return_to` in terms an operator can act on: which of the
 * two lists (built-in vs admin-managed) was consulted, and which one it failed.
 */
export function buildReturnToDiagnostic(
  candidate: string | null | undefined,
  extras: readonly string[] = getExtraReturnToOrigins(),
): ReturnToDiagnostic {
  const verdict = explainReturnTo(candidate, extras);
  const present = typeof candidate === "string" && candidate.trim().length > 0;
  const matchedBaseAllowlist = verdict.code === "allowed_base";
  const matchedAdminAllowlist = verdict.code === "allowed_extra";

  const base = {
    verdict,
    rejected: present && !verdict.allowed,
    origin: verdict.origin,
    matchedBaseAllowlist,
    matchedAdminAllowlist,
    baseAllowlistCount: ALLOWED_RETURN_TO_ORIGINS.length,
    adminAllowlistCount: extras.length,
  };

  if (!present) {
    return {
      ...base,
      headline: "No return_to supplied",
      detail: "No return_to was provided, so Hub defaults are used.",
    };
  }

  if (verdict.allowed) {
    return {
      ...base,
      headline: matchedAdminAllowlist
        ? "return_to accepted (admin allowlist)"
        : "return_to accepted (built-in allowlist)",
      detail: matchedAdminAllowlist
        ? `Origin ${verdict.origin} matched an admin-managed allowlist entry.`
        : `Origin ${verdict.origin} matched a built-in Hub/spoke origin.`,
    };
  }

  if (verdict.code === "origin_not_allowlisted") {
    return {
      ...base,
      headline: "return_to origin is not allowlisted",
      detail:
        `Received origin ${verdict.origin}. It is not one of the ` +
        `${base.baseAllowlistCount} built-in Hub/spoke origins, and it does not ` +
        (base.adminAllowlistCount === 0
          ? "match any admin allowlist entry (the admin allowlist is currently empty). " +
            "Add it on /admin/return-to-allowlist."
          : `match any of the ${base.adminAllowlistCount} admin allowlist entries. ` +
            "Check the entry is enabled and its origin matches exactly (scheme, host, port) on /admin/return-to-allowlist."),
    };
  }

  // Structural failures never reached either list.
  return {
    ...base,
    headline: "return_to failed structural validation",
    detail: `${verdict.reason} Neither the built-in nor the admin allowlist was consulted.`,
  };
}

/**
 * Log a rejected `return_to` to the server log / browser console.
 *
 * Safe to call unconditionally: absent and accepted values log nothing.
 * Returns the diagnostic so callers can also render it.
 */
export function logReturnToRejection(
  surface: ReturnToAuditSurface,
  candidate: string | null | undefined,
  extras?: readonly string[],
): ReturnToDiagnostic {
  const diag = buildReturnToDiagnostic(candidate, extras);
  if (!diag.rejected) return diag;
  console.warn(
    `[return_to] REJECTED on ${surface}: ${diag.headline} — ` +
      `origin=${diag.origin ?? "<unparseable>"} code=${diag.verdict.code} ` +
      `builtInOrigins=${diag.baseAllowlistCount} adminOrigins=${diag.adminAllowlistCount}. ` +
      diag.detail,
  );
  return diag;
}
