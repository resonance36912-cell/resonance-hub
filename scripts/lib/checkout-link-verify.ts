/**
 * Pure helpers backing scripts/verify-checkout-links.ts.
 * Extracted so they can be unit-tested with `bun test`.
 */
import { SKU_CATALOG } from "../../src/lib/checkout.functions";

/** Strip block and line comments from TS/TSX source. */
export function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

/** True when `${app}:${plan}:monthly` exists in SKU_CATALOG. */
export function isValidSku(app: string, plan: string): boolean {
  return Boolean(SKU_CATALOG[`${app}:${plan}:monthly`]);
}

/**
 * Registry of every query parameter the /checkout route understands and the
 * validator each literal value must satisfy. Anything not listed here is
 * rejected — a new tracking param must be added intentionally so the ingest
 * side (checkout.tsx / analytics) stays in sync with the CTA surface.
 *
 * `dynamicSafe: true` means the verifier accepts `${…}` interpolations for
 * this param WITHOUT a per-file allowlist, because the value is always
 * URI-encoded at the call site or is otherwise structurally safe. Params
 * with `dynamicSafe: false` require an explicit allowlist entry.
 */
export type ParamSpec = {
  /** Regex the literal value must match (post URL-decoding). */
  pattern: RegExp;
  /** If true, `${…}` interpolations are allowed anywhere. */
  dynamicSafe: boolean;
  /** Human-readable description for error messages. */
  description: string;
};

// Shared shapes.
const ID_SHAPE = /^[a-z0-9_]{1,64}$/;                // app, plan, pack ids
const TRACKING_SHAPE = /^[A-Za-z0-9_.\-]{1,64}$/;    // ref, utm_*
// return_to must be root-relative (no scheme, no //). Keeps the redirect
// resolver from following an off-site URL smuggled through the CTA.
const RETURN_TO_SHAPE = /^\/(?!\/)[A-Za-z0-9/_\-.~%?=&#]{0,256}$/;

export const CHECKOUT_PARAM_SPECS: Record<string, ParamSpec> = {
  app:        { pattern: ID_SHAPE,         dynamicSafe: false, description: "app id (a-z0-9_)" },
  plan:       { pattern: ID_SHAPE,         dynamicSafe: false, description: "plan id (a-z0-9_)" },
  pack:       { pattern: ID_SHAPE,         dynamicSafe: false, description: "pack id (a-z0-9_)" },
  ref:        { pattern: TRACKING_SHAPE,   dynamicSafe: true,  description: "referrer token" },
  utm_source: { pattern: TRACKING_SHAPE,   dynamicSafe: true,  description: "utm_source" },
  utm_medium: { pattern: TRACKING_SHAPE,   dynamicSafe: true,  description: "utm_medium" },
  utm_campaign:{pattern: TRACKING_SHAPE,   dynamicSafe: true,  description: "utm_campaign" },
  utm_content:{ pattern: TRACKING_SHAPE,   dynamicSafe: true,  description: "utm_content" },
  utm_term:   { pattern: TRACKING_SHAPE,   dynamicSafe: true,  description: "utm_term" },
  return_to:  { pattern: RETURN_TO_SHAPE,  dynamicSafe: false, description: "root-relative /path" },
};

/**
 * Validate the shape of every param on a /checkout URL. Returns a list of
 * error strings (empty when the URL is clean).
 *
 * `allowedDynamicParams` names params whose `${…}` interpolations should be
 * accepted for the current file — set by DYNAMIC_PARAM_ALLOWLIST at the
 * call site.
 */
export function validateCheckoutParams(
  rawQuery: string,
  fileLabel: string,
  allowedDynamicParams: ReadonlySet<string> = new Set(),
): string[] {
  const errors: string[] = [];
  // URLSearchParams URL-decodes values for us; we validate the decoded form.
  const params = new URLSearchParams(rawQuery.replace(/&amp;/g, "&"));
  const seen = new Set<string>();

  for (const [key, value] of params) {
    if (seen.has(key)) {
      errors.push(`${fileLabel}: duplicate param "${key}" in /checkout URL`);
      continue;
    }
    seen.add(key);

    const spec = CHECKOUT_PARAM_SPECS[key];
    if (!spec) {
      errors.push(
        `${fileLabel}: unknown /checkout param "${key}" — add it to ` +
          `CHECKOUT_PARAM_SPECS after wiring the ingest side.`,
      );
      continue;
    }

    const isDynamic = value.includes("${");
    if (isDynamic) {
      if (!spec.dynamicSafe && !allowedDynamicParams.has(key)) {
        errors.push(
          `${fileLabel}: dynamic value for "${key}" ("${value}") — add "${key}" to ` +
            `DYNAMIC_PARAM_ALLOWLIST["${fileLabel}"] or inline a literal.`,
        );
      }
      continue;
    }

    if (!spec.pattern.test(value)) {
      errors.push(
        `${fileLabel}: invalid "${key}=${value}" — expected ${spec.description}.`,
      );
    }
  }

  return errors;
}

export type ExtractResult =
  | { value: string; error?: undefined }
  | { value?: undefined; error: string };

/**
 * Extract a string-literal value for `field` from an object-literal arg block.
 * Supports:
 *   - direct string literal:        `field: "value"`
 *   - in-file const reference:      `field: NAME`  where the surrounding file
 *     contains  `const NAME = "value" as const;`  (or without `as const`)
 */
export function extractFieldLiteral(
  argBlock: string,
  field: string,
  fullSrc: string,
  fileLabel: string,
): ExtractResult {
  const fieldRe = new RegExp(`\\b${field}\\s*:\\s*([^,\\n}]+)`);
  const fm = argBlock.match(fieldRe);
  if (!fm) {
    return { error: `${fileLabel}: call missing "${field}" property` };
  }
  const raw = fm[1].trim().replace(/,$/, "").trim();

  const strLit = raw.match(/^["']([^"']+)["']$/);
  if (strLit) return { value: strLit[1] };

  const ident = raw.match(/^[A-Za-z_$][\w$]*$/);
  if (ident) {
    const constRe = new RegExp(
      `\\bconst\\s+${ident[0]}\\s*=\\s*["']([^"']+)["']\\s*(?:as\\s+const)?\\s*;`,
    );
    const cm = fullSrc.match(constRe);
    if (cm) return { value: cm[1] };
    return {
      error: `${fileLabel}: "${field}: ${ident[0]}" — could not resolve identifier to a string literal; ` +
        `inline the value or define it as \`const ${ident[0]} = "..." as const;\` in the same file.`,
    };
  }

  return {
    error: `${fileLabel}: "${field}: ${raw}" — value must be a string literal or an in-file const literal.`,
  };
}
