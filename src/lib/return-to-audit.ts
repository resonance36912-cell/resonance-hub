/**
 * Redirect audit records for post-checkout `return_to` handling.
 *
 * PRIVACY CONTRACT — this module exists so we can answer "was this redirect
 * allowed, and where did the user actually go?" WITHOUT retaining
 * attacker- or user-supplied URLs:
 *
 *   • The candidate `return_to` is reduced to its normalized **origin** only
 *     (scheme + host + non-default port). Path, query, and fragment are
 *     dropped before anything is persisted — those are the parts that can
 *     carry tokens, emails, document ids, or phishing payloads.
 *   • When the candidate cannot be parsed as a plain http(s) URL there is no
 *     origin to keep, so `candidateOrigin` is `null` and only the reason code
 *     is recorded. The raw string is never stored or logged.
 *   • The canonical redirect target is Hub/registry-derived (never
 *     caller-controlled), so it is recorded as origin + path with query and
 *     fragment stripped.
 *
 * The verdict is always recomputed here from the allowlist — callers cannot
 * assert "allow".
 */

import { explainReturnTo, type ReturnToVerdict } from "./return-to-allowlist";

export const RETURN_TO_AUDIT_SURFACES = [
  "checkout_success",
  "checkout_cancel",
  "payfast_launch",
  "payfast_retry",
] as const;

export type ReturnToAuditSurface = (typeof RETURN_TO_AUDIT_SURFACES)[number];

/** Canonical redirect target, already resolved by Hub-side logic. */
export type ReturnToAuditTarget =
  | { kind: "external"; href: string }
  | { kind: "internal"; to: string; hash?: string }
  | null;

export type ReturnToAuditRecord = {
  surface: ReturnToAuditSurface;
  verdict: "allow" | "deny";
  reasonCode: ReturnToVerdict["code"];
  /** Normalized origin of the candidate, or `null` when unparseable/absent. */
  candidateOrigin: string | null;
  /** Whether a `return_to` was supplied at all (distinguishes deny vs. absent). */
  candidatePresent: boolean;
  targetKind: "external" | "internal" | null;
  /** Origin of the canonical target when external. */
  targetOrigin: string | null;
  /** Path (plus hash for internal targets). Never query strings. */
  targetPath: string | null;
  sku: string | null;
  pack: string | null;
};

/** Strip query/fragment from an absolute URL, keeping origin + path. */
function splitTarget(href: string): { origin: string | null; path: string | null } {
  try {
    const u = new URL(href);
    if (u.protocol !== "https:" && u.protocol !== "http:") {
      return { origin: null, path: null };
    }
    return { origin: u.origin, path: u.pathname || "/" };
  } catch {
    return { origin: null, path: null };
  }
}

/**
 * Build a privacy-safe audit record. `candidate` may be the raw caller value —
 * it is reduced to an origin (or dropped) before it leaves this function.
 */
export function buildReturnToAuditRecord(input: {
  surface: ReturnToAuditSurface;
  candidate: string | null | undefined;
  target?: ReturnToAuditTarget;
  sku?: string | null;
  pack?: string | null;
  extras?: readonly string[];
}): ReturnToAuditRecord {
  const candidatePresent =
    typeof input.candidate === "string" && input.candidate.trim().length > 0;

  const verdict: ReturnToVerdict = candidatePresent
    ? input.extras
      ? explainReturnTo(input.candidate, input.extras)
      : explainReturnTo(input.candidate)
    : {
        input: "",
        allowed: false,
        origin: null,
        code: "empty",
        reason: "No return_to supplied — default target used.",
      };

  let targetKind: ReturnToAuditRecord["targetKind"] = null;
  let targetOrigin: string | null = null;
  let targetPath: string | null = null;

  const target = input.target ?? null;
  if (target?.kind === "external") {
    targetKind = "external";
    const parts = splitTarget(target.href);
    targetOrigin = parts.origin;
    targetPath = parts.path;
  } else if (target?.kind === "internal") {
    targetKind = "internal";
    targetPath = target.hash ? `${target.to}#${target.hash}` : target.to;
  }

  return {
    surface: input.surface,
    verdict: verdict.allowed ? "allow" : "deny",
    reasonCode: verdict.code,
    // Origin-only. Never the full candidate URL.
    candidateOrigin: verdict.origin,
    candidatePresent,
    targetKind,
    targetOrigin,
    targetPath,
    sku: input.sku ?? null,
    pack: input.pack ?? null,
  };
}
