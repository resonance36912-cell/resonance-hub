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
