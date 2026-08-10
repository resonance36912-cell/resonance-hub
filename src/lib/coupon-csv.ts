// -----------------------------------------------------------------------------
// Client-safe CSV parsing for bulk coupon import.
// Pure functions only — imported by both the admin UI and the server function so
// the browser preview and the server validation agree on interpretation.
// -----------------------------------------------------------------------------

import type { CouponKind } from "./coupons";

export const COUPON_CSV_COLUMNS = [
  "code",
  "kind",
  "description",
  "discount_type",
  "discount_percent",
  "discount_rands",
  "credits_amount",
  "credits_app",
  "entitlement_app_key",
  "entitlement_tier",
  "entitlement_days",
  "applies_to_apps",
  "applies_to_skus",
  "valid_until",
  "max_redemptions",
  "max_per_user",
  "enabled",
] as const;

export const COUPON_CSV_TEMPLATE = [
  COUPON_CSV_COLUMNS.join(","),
  "LAUNCH10,discount,10% launch offer,percent,10,,,,,,,,,2026-12-31,100,1,true",
  "R50OFF,discount,R50 off any pack,fixed,,50,,,,,,,,,50,1,true",
  "FREE500,credits,500 free credits,,,,500,creative_studio,,,,creative_studio,,,25,1,true",
  "PROMONTH,entitlement,One month Pro access,,,,,,creative_studio,pro,30,,,,10,1,true",
].join("\n");

export const MAX_COUPON_CSV_ROWS = 500;

/** Payload shape accepted by the bulk import server function. */
export type CouponImportRow = {
  code: string;
  kind: CouponKind;
  description: string | null;
  discountType: "percent" | "fixed" | null;
  discountPercent: number | null;
  discountCents: number | null;
  creditsAmount: number | null;
  creditsApp: string | null;
  entitlementAppKey: string | null;
  entitlementTier: string | null;
  entitlementDays: number | null;
  appliesToApps: string[];
  appliesToSkus: string[];
  validUntil: string | null;
  maxRedemptions: number | null;
  maxPerUser: number;
  enabled: boolean;
};

export type CouponCsvIssue = { line: number; code: string | null; message: string };

export type CouponCsvParseResult = {
  rows: CouponImportRow[];
  issues: CouponCsvIssue[];
};

/** Minimal RFC4180-ish splitter: handles quoted fields and escaped quotes. */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((v) => v.trim());
}

function toList(v: string): string[] {
  return v
    .split(/[;|]/)
    .flatMap((p) => p.split(","))
    .map((p) => p.trim())
    .filter(Boolean)
    .slice(0, 20);
}

function toNumber(v: string): number | null {
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function toBool(v: string, fallback = true): boolean {
  if (!v) return fallback;
  return /^(1|true|yes|y|active|enabled)$/i.test(v);
}

function toIsoDate(v: string): string | null {
  if (!v) return null;
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T23:59:59Z` : v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * Parses a CSV blob into coupon import rows, collecting per-line issues instead
 * of throwing so the admin can see every problem at once.
 */
export function parseCouponCsv(text: string): CouponCsvParseResult {
  const issues: CouponCsvIssue[] = [];
  const rows: CouponImportRow[] = [];

  const lines = text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#"));

  if (lines.length === 0) {
    return { rows, issues: [{ line: 0, code: null, message: "CSV is empty" }] };
  }

  const header = splitCsvLine(lines[0]!).map((h) => h.toLowerCase().replace(/\s+/g, "_"));
  if (!header.includes("code") || !header.includes("kind")) {
    return {
      rows,
      issues: [
        {
          line: 1,
          code: null,
          message: "Header row must include at least 'code' and 'kind' columns",
        },
      ],
    };
  }

  const seen = new Set<string>();

  for (let i = 1; i < lines.length; i += 1) {
    const lineNo = i + 1;
    const cells = splitCsvLine(lines[i]!);
    const get = (name: string): string => {
      const idx = header.indexOf(name);
      return idx === -1 ? "" : (cells[idx] ?? "");
    };

    const code = get("code").toUpperCase();
    if (!code) {
      issues.push({ line: lineNo, code: null, message: "Missing code" });
      continue;
    }
    if (!/^[A-Z0-9_-]{3,64}$/.test(code)) {
      issues.push({
        line: lineNo,
        code,
        message: "Code must be 3–64 characters of letters, numbers, - or _",
      });
      continue;
    }
    if (seen.has(code)) {
      issues.push({ line: lineNo, code, message: "Duplicate code in this CSV" });
      continue;
    }

    const kindRaw = get("kind").toLowerCase();
    if (kindRaw !== "discount" && kindRaw !== "credits" && kindRaw !== "entitlement") {
      issues.push({
        line: lineNo,
        code,
        message: "Kind must be discount, credits or entitlement",
      });
      continue;
    }
    const kind = kindRaw as CouponKind;

    const discountTypeRaw = get("discount_type").toLowerCase();
    const discountPercent = toNumber(get("discount_percent"));
    const rands = toNumber(get("discount_rands"));
    const discountCentsDirect = toNumber(get("discount_cents"));
    const discountCents =
      discountCentsDirect ?? (rands != null ? Math.round(rands * 100) : null);
    const discountType: "percent" | "fixed" | null =
      kind !== "discount"
        ? null
        : discountTypeRaw === "percent" || discountTypeRaw === "fixed"
          ? discountTypeRaw
          : discountPercent != null
            ? "percent"
            : discountCents != null
              ? "fixed"
              : null;

    const creditsAmount = toNumber(get("credits_amount"));
    const entitlementDays = toNumber(get("entitlement_days"));
    const validUntilRaw = get("valid_until");
    const validUntil = toIsoDate(validUntilRaw);
    if (validUntilRaw && !validUntil) {
      issues.push({ line: lineNo, code, message: `Unrecognised date: ${validUntilRaw}` });
      continue;
    }

    const row: CouponImportRow = {
      code,
      kind,
      description: get("description") || null,
      discountType,
      discountPercent: kind === "discount" && discountType === "percent" ? discountPercent : null,
      discountCents: kind === "discount" && discountType === "fixed" ? discountCents : null,
      creditsAmount: kind === "credits" ? creditsAmount : null,
      creditsApp: kind === "credits" ? get("credits_app") || null : null,
      entitlementAppKey: kind === "entitlement" ? get("entitlement_app_key") || null : null,
      entitlementTier: kind === "entitlement" ? get("entitlement_tier") || null : null,
      entitlementDays: kind === "entitlement" ? entitlementDays : null,
      appliesToApps: toList(get("applies_to_apps")),
      appliesToSkus: toList(get("applies_to_skus")),
      validUntil,
      maxRedemptions: toNumber(get("max_redemptions")),
      maxPerUser: toNumber(get("max_per_user")) ?? 1,
      enabled: toBool(get("enabled")),
    };

    // Kind-specific completeness — mirrors the server-side upsert rules.
    if (kind === "discount") {
      if (!discountType) {
        issues.push({ line: lineNo, code, message: "Discount needs discount_type (percent or fixed)" });
        continue;
      }
      if (discountType === "percent" && !(row.discountPercent && row.discountPercent >= 1 && row.discountPercent <= 100)) {
        issues.push({ line: lineNo, code, message: "discount_percent must be 1–100" });
        continue;
      }
      if (discountType === "fixed" && !(row.discountCents && row.discountCents >= 1)) {
        issues.push({ line: lineNo, code, message: "discount_rands must be greater than 0" });
        continue;
      }
    }
    if (kind === "credits" && !(row.creditsAmount && row.creditsAmount >= 1 && row.creditsApp)) {
      issues.push({ line: lineNo, code, message: "Credit coupons need credits_amount and credits_app" });
      continue;
    }
    if (kind === "entitlement" && !(row.entitlementAppKey && row.entitlementTier)) {
      issues.push({
        line: lineNo,
        code,
        message: "Entitlement coupons need entitlement_app_key and entitlement_tier",
      });
      continue;
    }

    seen.add(code);
    rows.push(row);
  }

  if (rows.length > MAX_COUPON_CSV_ROWS) {
    issues.push({
      line: 0,
      code: null,
      message: `Too many rows (${rows.length}); import at most ${MAX_COUPON_CSV_ROWS} at a time`,
    });
    return { rows: rows.slice(0, MAX_COUPON_CSV_ROWS), issues };
  }

  return { rows, issues };
}
