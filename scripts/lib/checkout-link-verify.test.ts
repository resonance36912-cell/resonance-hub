/**
 * Unit tests for scripts/lib/checkout-link-verify.ts.
 *
 * Covers:
 *   - stripComments removes block and line comments without eating URLs
 *   - extractFieldLiteral resolves inline string literals and in-file consts
 *   - extractFieldLiteral surfaces actionable errors for unsupported shapes
 *   - isValidSku reflects SKU_CATALOG truth (positive + negative cases)
 *
 * Run with:  bun test scripts/lib/checkout-link-verify.test.ts
 */
import { describe, expect, test } from "bun:test";
import {
  stripComments,
  extractFieldLiteral,
  isValidSku,
  validateCheckoutParams,
} from "./checkout-link-verify";

describe("validateCheckoutParams", () => {
  const file = "src/routes/x.tsx";

  test("accepts a canonical app/plan link", () => {
    expect(validateCheckoutParams("app=epublisher&plan=starter", file)).toEqual([]);
  });

  test("accepts a pack link", () => {
    expect(validateCheckoutParams("pack=epublisher_lifetime", file)).toEqual([]);
  });

  test("accepts ref and utm_* tracking params", () => {
    const q = "app=epublisher&plan=starter&ref=partner_x&utm_source=twitter&utm_medium=cpc&utm_campaign=launch-2026&utm_content=hero.cta&utm_term=ai_writer";
    expect(validateCheckoutParams(q, file)).toEqual([]);
  });

  test("accepts a root-relative return_to", () => {
    expect(validateCheckoutParams("app=epublisher&plan=starter&return_to=/account/subscriptions", file)).toEqual([]);
  });

  test("rejects an unknown param", () => {
    const errs = validateCheckoutParams("app=epublisher&plan=starter&sku=x", file);
    expect(errs.length).toBe(1);
    expect(errs[0]).toContain('unknown /checkout param "sku"');
  });

  test("rejects an off-site return_to", () => {
    const errs = validateCheckoutParams(
      "app=epublisher&plan=starter&return_to=" + encodeURIComponent("https://evil.com/x"),
      file,
    );
    expect(errs.length).toBe(1);
    expect(errs[0]).toContain('invalid "return_to');
  });

  test("rejects a protocol-relative return_to", () => {
    const errs = validateCheckoutParams(
      "app=epublisher&plan=starter&return_to=" + encodeURIComponent("//evil.com/x"),
      file,
    );
    expect(errs.length).toBe(1);
    expect(errs[0]).toContain('invalid "return_to');
  });

  test("rejects a badly shaped utm value", () => {
    const errs = validateCheckoutParams(
      "app=epublisher&plan=starter&utm_source=" + encodeURIComponent("bad value!"),
      file,
    );
    expect(errs.some((e) => e.includes('invalid "utm_source'))).toBe(true);
  });

  test("rejects duplicate params", () => {
    const errs = validateCheckoutParams("app=epublisher&plan=starter&ref=a&ref=b", file);
    expect(errs.some((e) => e.includes('duplicate param "ref"'))).toBe(true);
  });

  test("rejects dynamic values for dynamicSafe:false params without allowlist", () => {
    const errs = validateCheckoutParams("app=${x}&plan=starter", file);
    expect(errs.some((e) => e.includes('dynamic value for "app"'))).toBe(true);
  });

  test("accepts dynamic values when the file allowlists that param", () => {
    const errs = validateCheckoutParams(
      "app=${x}&plan=${y}&return_to=${z}",
      file,
      new Set(["app", "plan", "return_to"]),
    );
    expect(errs).toEqual([]);
  });

  test("accepts dynamic tracking params without allowlist (dynamicSafe)", () => {
    const errs = validateCheckoutParams("app=epublisher&plan=starter&utm_source=${src}", file);
    expect(errs).toEqual([]);
  });
});

describe("stripComments", () => {
  test("removes block comments", () => {
    expect(stripComments("a /* /checkout?app=x&plan=y */ b")).toBe("a  b");
  });

  test("removes line comments but keeps the leading char before //", () => {
    const out = stripComments(`code; // /checkout?app=fake&plan=nope\nnext`);
    expect(out).toContain("code;");
    expect(out).not.toContain("checkout?app=fake");
    expect(out).toContain("next");
  });

  test("does not eat URLs (https://) — the `://` guard preserves them", () => {
    const src = `const u = "https://example.com/path";`;
    expect(stripComments(src)).toBe(src);
  });

  test("strips multi-line block comments containing checkout examples", () => {
    const src = `/**\n * Example: /checkout?sku=...&return_to=https://evil.com\n */\nreal();`;
    const out = stripComments(src);
    expect(out).not.toContain("checkout?sku=");
    expect(out).toContain("real();");
  });
});

describe("extractFieldLiteral — direct string literals", () => {
  test("resolves a double-quoted literal", () => {
    const r = extractFieldLiteral(`app: "epublisher", required: "pro"`, "app", "", "f.ts");
    expect(r.value).toBe("epublisher");
    expect(r.error).toBeUndefined();
  });

  test("resolves a single-quoted literal", () => {
    const r = extractFieldLiteral(`app: 'creative_studio'`, "app", "", "f.ts");
    expect(r.value).toBe("creative_studio");
  });

  test("tolerates trailing comma and whitespace", () => {
    const r = extractFieldLiteral(`  app:   "sync_vision"  ,\n`, "app", "", "f.ts");
    expect(r.value).toBe("sync_vision");
  });
});

describe("extractFieldLiteral — in-file const references", () => {
  const fullSrc = `
    const APP = "creative_studio" as const;
    const REQUIRED_TIER = "creator" as const;
    const LOOSE = "all_access";
  `;

  test("resolves `as const` identifier", () => {
    const r = extractFieldLiteral(`app: APP`, "app", fullSrc, "f.ts");
    expect(r.value).toBe("creative_studio");
  });

  test("resolves identifier with second-arg field name", () => {
    const r = extractFieldLiteral(`required: REQUIRED_TIER`, "required", fullSrc, "f.ts");
    expect(r.value).toBe("creator");
  });

  test("resolves plain const (without `as const`)", () => {
    const r = extractFieldLiteral(`app: LOOSE`, "app", fullSrc, "f.ts");
    expect(r.value).toBe("all_access");
  });

  test("fails actionably when identifier is undefined in the file", () => {
    const r = extractFieldLiteral(`app: MISSING`, "app", fullSrc, "f.ts");
    expect(r.value).toBeUndefined();
    expect(r.error).toContain("MISSING");
    expect(r.error).toContain("could not resolve identifier");
  });
});

describe("extractFieldLiteral — error paths", () => {
  test("fails when the field is absent from the arg block", () => {
    const r = extractFieldLiteral(`required: "pro"`, "app", "", "f.ts");
    expect(r.error).toContain(`missing "app" property`);
  });

  test("rejects non-literal expressions (template literals, calls, etc.)", () => {
    const r = extractFieldLiteral(
      "app: someVar() + 'x'",
      "app",
      "",
      "f.ts",
    );
    expect(r.error).toBeDefined();
    expect(r.error).toContain("must be a string literal");
  });

  test("does not cross-match similarly-named fields", () => {
    // "appended" should not satisfy a request for "app"
    const r = extractFieldLiteral(`appended: "wrong", app: "right"`, "app", "", "f.ts");
    expect(r.value).toBe("right");
  });
});

describe("isValidSku — SKU catalog validation", () => {
  test.each([
    ["epublisher", "starter"],
    ["epublisher", "business"],
    ["creative_studio", "creator"],
    ["sync_vision", "pro"],
    ["youtube_optimizer", "starter"],
    ["all_access", "all_access"],
  ] as const)("accepts known SKU %s:%s:monthly", (app, plan) => {
    expect(isValidSku(app, plan)).toBe(true);
  });

  test.each([
    ["epublisher", "all_access"],          // wrong tier for app
    ["creative_studio", "starter"],        // creative_studio has no starter
    ["youtube_optimizer", "creator"],      // youtube_optimizer has no creator
    ["sync_vision", "free"],               // free is not a paid SKU
    ["unknown_app", "pro"],                // unknown app
    ["epublisher", ""],                    // empty plan
    ["", "pro"],                           // empty app
  ] as const)("rejects invalid SKU %s:%s:monthly", (app, plan) => {
    expect(isValidSku(app, plan)).toBe(false);
  });
});
