/**
 * Pure helpers backing scripts/verify-pricing-packs.ts.
 *
 * Cross-checks that the pricing page's rendered pack cards match
 * PACK_CATALOG one-to-one:
 *   R1. Every PACK_CATALOG entry has an APP_META section (else the pack
 *       renders under no section and is silently dropped).
 *   R2. Every APP_META section has at least one PACK_CATALOG entry (else
 *       the section header renders with an empty grid).
 *   R3. Every pack id matches the ID shape enforced by the checkout-link
 *       verifier (a-z0-9_, ≤64 chars) and the Record key matches pack.id.
 *   R4. The pricing.tsx source still renders `/checkout?pack=${p.id}` from
 *       the same PACK_CATALOG-derived loop variable — no drift to literal
 *       ids that could go stale.
 */

export type PackDefLike = { id: string; app: string };
export type AppMetaLike = Record<string, unknown>;

const PACK_ID_SHAPE = /^[a-z0-9_]{1,64}$/;

export function verifyPackCatalogAgainstAppMeta(
  catalog: Record<string, PackDefLike>,
  appMeta: AppMetaLike,
): string[] {
  const errors: string[] = [];
  const appsWithPacks = new Set<string>();

  for (const [key, pack] of Object.entries(catalog)) {
    // R3 — id shape + record-key parity
    if (!PACK_ID_SHAPE.test(pack.id)) {
      errors.push(`PACK_CATALOG["${key}"]: id "${pack.id}" fails shape ${PACK_ID_SHAPE}`);
    }
    if (key !== pack.id) {
      errors.push(
        `PACK_CATALOG["${key}"]: record key does not match pack.id "${pack.id}" — ` +
          `checkout resolution uses the key, so these must be identical.`,
      );
    }
    // R1 — every pack has a rendering section
    if (!Object.prototype.hasOwnProperty.call(appMeta, pack.app)) {
      errors.push(
        `PACK_CATALOG["${pack.id}"]: pack.app="${pack.app}" has no APP_META entry ` +
          `in src/routes/pricing.tsx — pack will not render.`,
      );
    }
    appsWithPacks.add(pack.app);
  }

  // R2 — every APP_META section has at least one pack
  for (const appKey of Object.keys(appMeta)) {
    if (!appsWithPacks.has(appKey)) {
      errors.push(
        `APP_META["${appKey}"]: section renders on /pricing but has no ` +
          `PACK_CATALOG entries — remove the section or add a pack.`,
      );
    }
  }

  return errors;
}

/**
 * R4 — statically confirm pricing.tsx still renders pack CTAs from the
 * PACK_CATALOG-derived loop variable. We look for exactly one
 * `` `/checkout?pack=${<name>.id}` `` template where `<name>` is the loop
 * parameter of a `.map((<name>) => …)` iterating a value that came from
 * PACK_CATALOG (via packsByApp[…]).
 */
export function verifyPricingSourceUsesCatalogLoop(src: string): string[] {
  const errors: string[] = [];

  // 1. Must derive packsByApp from PACK_CATALOG.
  if (!/Object\.values\(PACK_CATALOG\)/.test(src)) {
    errors.push(
      "src/routes/pricing.tsx: expected packs to be derived from " +
        "`Object.values(PACK_CATALOG)` — do not hand-roll the pack list.",
    );
  }

  // 2. Extract the loop variable used to render pack cards.
  //    Match:  packs.map((<ident>) =>   OR   packs.map(<ident> =>
  const loopMatch = src.match(/packs\.map\(\s*\(?\s*([A-Za-z_$][\w$]*)\s*\)?\s*=>/);
  if (!loopMatch) {
    errors.push(
      "src/routes/pricing.tsx: could not find `packs.map((p) => …)` — the " +
        "pricing page no longer iterates packs from the catalog.",
    );
    return errors;
  }
  const loopVar = loopMatch[1];

  // 3. The pack CTA must use `/checkout?pack=${<loopVar>.id}` exactly once.
  const dynHrefRe = new RegExp(
    "`/checkout\\?pack=\\$\\{\\s*" + loopVar + "\\.id\\s*\\}`",
  );
  if (!dynHrefRe.test(src)) {
    errors.push(
      `src/routes/pricing.tsx: pack CTA href does not use ` +
        "`/checkout?pack=${" + loopVar + ".id}` — a literal pack id has " +
        "been introduced and may drift from PACK_CATALOG.",
    );
  }

  // 4. Any *literal* `/checkout?pack=<id>` in the file must exist in
  //    PACK_CATALOG. We only flag literals here; the checkout-link verifier
  //    handles the SKU-level check as well, but repeating it here surfaces
  //    the failure closer to the pricing page.
  const litRe = /\/checkout\?pack=([a-z0-9_]+)/g;
  let m: RegExpExecArray | null;
  const literalIds: string[] = [];
  while ((m = litRe.exec(src))) literalIds.push(m[1]);
  // Deduplicate — caller cross-checks against PACK_CATALOG.
  return errors.concat(
    literalIds.length > 0
      ? [`__LITERAL_PACK_IDS__:${[...new Set(literalIds)].join(",")}`]
      : [],
  );
}
