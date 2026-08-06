/**
 * Curated corpus of hostile / malformed `return_to` candidates.
 *
 * Every entry here is expected to FAIL either the structural check used by
 * PayFast `return_url` signing (`isStructurallySafeReturnTo`) or the
 * origin allowlist (`explainReturnTo`). The corpus mirrors the counterexample
 * classes covered by the fuzz / normalization test suites under
 * `scripts/lib/return-to-allowlist-*.test.ts`, so `/admin/return-to-counterexamples`
 * shows the exact verdict the runtime would produce for each class.
 *
 * Privacy: the corpus is synthetic (no real user URLs) and the display layer
 * still sanitizes each candidate — the path/query/fragment is reduced to a
 * shape marker, never rendered verbatim beyond its structure.
 */

import {
  explainReturnTo,
  isStructurallySafeReturnTo,
  type ReturnToVerdict,
} from "./return-to-allowlist";

export type CounterexampleCategory =
  | "scheme"
  | "userinfo"
  | "host-graft"
  | "homoglyph"
  | "port"
  | "relative"
  | "encoding"
  | "empty";

export type Counterexample = {
  id: string;
  category: CounterexampleCategory;
  /** Raw candidate input (synthetic). */
  input: string;
  /** Why this class matters. */
  attack: string;
};

export const RETURN_TO_COUNTEREXAMPLES: readonly Counterexample[] = [
  // ── scheme ────────────────────────────────────────────────────────────
  {
    id: "javascript-uri",
    category: "scheme",
    input: "javascript:alert(document.domain)",
    attack: "Script execution if the value were rendered as an href.",
  },
  {
    id: "data-uri",
    category: "scheme",
    input: "data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==",
    attack: "Inline phishing document served from the CTA.",
  },
  {
    id: "file-uri",
    category: "scheme",
    input: "file:///etc/passwd",
    attack: "Local-file probe; never a valid post-checkout target.",
  },
  {
    id: "vbscript-uri",
    category: "scheme",
    input: "vbscript:msgbox(1)",
    attack: "Legacy script scheme.",
  },
  {
    id: "ftp-uri",
    category: "scheme",
    input: "ftp://reson8.life/",
    attack: "Non-http(s) transport on an otherwise trusted host.",
  },

  // ── userinfo smuggling ────────────────────────────────────────────────
  {
    id: "userinfo-display-host",
    category: "userinfo",
    input: "https://reson8.life@evil.example/checkout",
    attack: "Trusted host shown before @; the real origin is the attacker's.",
  },
  {
    id: "userinfo-reverse",
    category: "userinfo",
    input: "https://evil.example@reson8.life/",
    attack: "Userinfo smuggling that WHATWG .origin would silently ignore.",
  },
  {
    id: "userinfo-encoded",
    category: "userinfo",
    input: "https://user%3Apass@reson8.life/account",
    attack: "Percent-encoded credentials to slip past naive string checks.",
  },

  // ── host grafts ───────────────────────────────────────────────────────
  {
    id: "suffix-graft",
    category: "host-graft",
    input: "https://reson8.life.evil.example/checkout/success",
    attack: "Trusted host as a subdomain label of an attacker domain.",
  },
  {
    id: "prefix-graft",
    category: "host-graft",
    input: "https://evil-reson8.life/",
    attack: "Hyphenated lookalike registered by the attacker.",
  },
  {
    id: "tld-swap",
    category: "host-graft",
    input: "https://reson8.co/",
    attack: "Same brand, different TLD.",
  },
  {
    id: "subdomain-not-listed",
    category: "host-graft",
    input: "https://staging.reson8.life/",
    attack: "Unlisted subdomain of a trusted apex (may be attacker-controlled).",
  },
  {
    id: "trailing-dot",
    category: "host-graft",
    input: "https://reson8.life./",
    attack: "FQDN trailing dot bypasses exact-string host comparisons.",
  },
  {
    id: "open-redirect-param",
    category: "host-graft",
    input: "https://evil.example/?next=https://reson8.life/account",
    attack: "Trusted origin embedded in the query of a hostile origin.",
  },

  // ── homoglyphs ────────────────────────────────────────────────────────
  {
    id: "homoglyph-cyrillic",
    category: "homoglyph",
    input: "https://resоn8.life/",
    attack: "Cyrillic 'о' renders identically to ASCII 'o'.",
  },
  {
    id: "homoglyph-punycode",
    category: "homoglyph",
    input: "https://xn--reson8-6cd.life/",
    attack: "Punycode form of a visually confusable host.",
  },

  // ── ports ─────────────────────────────────────────────────────────────
  {
    id: "nondefault-port",
    category: "port",
    input: "https://reson8.life:8443/checkout",
    attack: "Non-default port on a trusted host — different origin.",
  },
  {
    id: "scheme-downgrade",
    category: "port",
    input: "http://reson8.life/account",
    attack: "Plaintext downgrade of an https-only origin.",
  },

  // ── relative / malformed ──────────────────────────────────────────────
  {
    id: "relative-path",
    category: "relative",
    input: "/account/subscriptions",
    attack: "Relative value cannot be signed as an absolute return_url.",
  },
  {
    id: "protocol-relative",
    category: "relative",
    input: "//evil.example/checkout",
    attack: "Protocol-relative URL inherits the page scheme and leaves the Hub.",
  },
  {
    id: "backslash-confusion",
    category: "relative",
    input: "https:/\\evil.example/",
    attack: "Backslash parser confusion between browsers and servers.",
  },
  {
    id: "space-prefixed",
    category: "relative",
    input: "  https://evil.example/",
    attack: "Leading whitespace used to defeat naive prefix checks.",
  },

  // ── encoding ──────────────────────────────────────────────────────────
  {
    id: "encoded-host-hostile",
    category: "encoding",
    input: "https://evil%2Eexample/checkout",
    attack: "Percent-encoded host separator on a hostile origin.",
  },
  {
    id: "crlf-injection",
    category: "encoding",
    input: "https://reson8.life/%0d%0aSet-Cookie:%20a=b",
    attack: "CRLF sequence aimed at header injection downstream.",
  },
  {
    id: "null-byte",
    category: "encoding",
    input: "https://evil.example/%00.reson8.life",
    attack: "Null byte truncation trick.",
  },

  // ── empty ─────────────────────────────────────────────────────────────
  {
    id: "empty-string",
    category: "empty",
    input: "",
    attack: "Empty value must fall back to the default target, not sign blank.",
  },
  {
    id: "whitespace-only",
    category: "empty",
    input: "   ",
    attack: "Whitespace-only value treated as empty.",
  },
];

export type SanitizedCounterexample = Counterexample & {
  /** Scheme as parsed, or null when unparseable. */
  scheme: string | null;
  /** Host as parsed (lowercased by the WHATWG parser), or null. */
  host: string | null;
  /** Explicit port, or null when default/absent. */
  port: string | null;
  /** True when the candidate carried user:pass credentials. */
  hasUserinfo: boolean;
  /** Structure of the path/query/fragment — never the literal values. */
  shape: string;
  /** Normalized origin considered by the allowlist, or null. */
  origin: string | null;
  /** Would pass the structural check used before PayFast signing. */
  signingEligible: boolean;
  /** Authoritative allowlist verdict. */
  verdict: ReturnToVerdict;
  /** Where the candidate fails first. */
  failsAt: "signing" | "allowlist" | "none";
};

/** Redact concrete path/query/fragment content down to a structural marker. */
function shapeOf(input: string): string {
  let parsed: URL | null = null;
  try {
    parsed = new URL(input);
  } catch {
    parsed = null;
  }
  if (!parsed) {
    const trimmed = input.trim();
    if (trimmed.length === 0) return "(empty)";
    return `(unparseable, ${trimmed.length} chars)`;
  }
  const parts: string[] = [];
  const segments = parsed.pathname.split("/").filter(Boolean).length;
  parts.push(segments === 0 ? "path:/" : `path:${segments} segment(s)`);
  const params = Array.from(parsed.searchParams.keys()).length;
  if (params > 0) parts.push(`query:${params} param(s)`);
  if (parsed.hash.length > 0) parts.push("fragment:present");
  if (/%[0-9a-f]{2}/i.test(input)) parts.push("percent-encoded");
  return parts.join(" · ");
}

/**
 * Run one counterexample through both gates and return display-safe fields.
 *
 * `extras` are the admin-managed origins to layer on top of the built-in
 * allowlist, so the page reflects the live effective policy.
 */
export function sanitizeCounterexample(
  example: Counterexample,
  extras: readonly string[] = [],
): SanitizedCounterexample {
  let parsed: URL | null = null;
  try {
    parsed = new URL(example.input);
  } catch {
    parsed = null;
  }

  const verdict = explainReturnTo(example.input, extras);
  const signingEligible = isStructurallySafeReturnTo(example.input);

  return {
    ...example,
    scheme: parsed ? parsed.protocol.replace(":", "") : null,
    host: parsed && parsed.host.length > 0 ? parsed.hostname : null,
    port: parsed && parsed.port.length > 0 ? parsed.port : null,
    hasUserinfo: Boolean(
      parsed && (parsed.username !== "" || parsed.password !== ""),
    ),
    shape: shapeOf(example.input),
    origin: verdict.origin,
    signingEligible,
    verdict,
    failsAt: !signingEligible
      ? "signing"
      : verdict.allowed
        ? "none"
        : "allowlist",
  };
}

/** Sanitize the whole corpus against the current effective allowlist. */
export function sanitizeCounterexamples(
  extras: readonly string[] = [],
  corpus: readonly Counterexample[] = RETURN_TO_COUNTEREXAMPLES,
): SanitizedCounterexample[] {
  return corpus.map((e) => sanitizeCounterexample(e, extras));
}

export const COUNTEREXAMPLE_CATEGORY_LABELS: Record<
  CounterexampleCategory,
  string
> = {
  scheme: "Non-http(s) scheme",
  userinfo: "Userinfo smuggling",
  "host-graft": "Host graft / lookalike",
  homoglyph: "Homoglyph host",
  port: "Port & scheme mismatch",
  relative: "Relative / malformed",
  encoding: "Encoding tricks",
  empty: "Empty value",
};
