/**
 * Validation + normalization for admin-entered `return_to` allowlist origins.
 *
 * Shared by the admin UI (live feedback) and `upsertReturnToOrigin` (the
 * authoritative gate) so both agree on exactly what may be stored.
 *
 * Policy:
 * - The value must parse as an absolute URL (relative paths are rejected).
 * - Only `https:` is stored. `http:` is allowed **only** for loopback hosts
 *   (`localhost`, `127.0.0.1`, `[::1]`) so local dev spokes can be registered.
 * - No userinfo (`user:pass@host`), no opaque origins, no wildcards, no
 *   whitespace or control characters anywhere in the input.
 * - Only the origin is persisted — path, query and fragment are discarded.
 */

export type AdminOriginVerdict =
  | { ok: true; origin: string; hadExtraParts: boolean }
  | { ok: false; code: AdminOriginRejectionCode; message: string };

export type AdminOriginRejectionCode =
  | "empty"
  | "whitespace"
  | "wildcard"
  | "malformed"
  | "scheme_not_http"
  | "insecure_scheme"
  | "userinfo"
  | "opaque_origin"
  | "too_long";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

const MAX_LENGTH = 300;

function reject(
  code: AdminOriginRejectionCode,
  message: string,
): AdminOriginVerdict {
  return { ok: false, code, message };
}

/** Validate and normalize an admin-entered origin. Never throws. */
export function validateAdminOrigin(raw: string): AdminOriginVerdict {
  const value = typeof raw === "string" ? raw.trim() : "";
  if (value.length === 0) return reject("empty", "Enter an origin URL.");
  if (value.length > MAX_LENGTH)
    return reject("too_long", `Value must be ${MAX_LENGTH} characters or less.`);
  if (/[\s\u0000-\u001f\u007f]/.test(value))
    return reject(
      "whitespace",
      "Whitespace and control characters are not allowed.",
    );
  if (value.includes("*"))
    return reject(
      "wildcard",
      "Wildcards are not supported — add each origin explicitly.",
    );

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return reject(
      "malformed",
      "Enter an absolute URL, e.g. https://app.example.com (relative values are rejected).",
    );
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:")
    return reject(
      "scheme_not_http",
      `Scheme "${parsed.protocol.replace(":", "")}" is not supported — use https.`,
    );

  if (parsed.username !== "" || parsed.password !== "")
    return reject(
      "userinfo",
      "URLs carrying userinfo (user:pass@host) are not allowed.",
    );

  const host = parsed.hostname.toLowerCase();
  if (parsed.protocol === "http:" && !LOOPBACK_HOSTS.has(host))
    return reject(
      "insecure_scheme",
      "Only https origins can be allowlisted (http is permitted for localhost only).",
    );

  const origin = parsed.origin;
  if (!origin || origin === "null")
    return reject("opaque_origin", "URL has an opaque origin.");

  const hadExtraParts =
    (parsed.pathname !== "" && parsed.pathname !== "/") ||
    parsed.search !== "" ||
    parsed.hash !== "";

  return { ok: true, origin: origin.toLowerCase(), hadExtraParts };
}

/** Throwing variant used by the server function before writing to the DB. */
export function normalizeAdminOriginOrThrow(raw: string): string {
  const verdict = validateAdminOrigin(raw);
  if (!verdict.ok) throw new Error(verdict.message);
  return verdict.origin;
}
