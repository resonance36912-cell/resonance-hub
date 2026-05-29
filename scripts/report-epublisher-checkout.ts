/**
 * Generate a concise HTML + JSON report from the same checks performed by
 * scripts/verify-epublisher-checkout.ts.
 *
 * Outputs:
 *   /mnt/documents/epublisher-checkout-report.json
 *   /mnt/documents/epublisher-checkout-report.html
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { SKU_CATALOG as HUB_CATALOG } from "../src/lib/checkout.functions";

const EPUB_TIERS = ["starter", "creator", "pro", "business"] as const;
type Tier = (typeof EPUB_TIERS)[number];

const hubAmount = (t: Tier) => HUB_CATALOG[`epublisher:${t}:monthly`].amountCents;

function itnAmount(t: Tier): number {
  const src = readFileSync("src/routes/api/public/payfast/itn.ts", "utf8");
  const m = src.match(
    new RegExp(`"epublisher:${t}:monthly":\\s*\\{[^}]*amountCents:\\s*(\\d+)`),
  );
  if (!m) throw new Error(`ITN catalog missing epublisher:${t}:monthly`);
  return Number(m[1]);
}

function pricingLabel(t: Tier): string {
  const src = readFileSync("src/routes/pricing.tsx", "utf8");
  const nameMap: Record<Tier, string> = {
    starter: "Starter", creator: "Creator", pro: "Pro", business: "Business",
  };
  const m = src.match(new RegExp(
    `name:\\s*"${nameMap[t]}",\\s*zar:\\s*"(R\\d+)"[^}]*href:\\s*"/checkout\\?app=epublisher&plan=${t}"`,
  ));
  if (!m) throw new Error(`Pricing page missing ePublisher ${t}`);
  return m[1];
}

function sig(params: Record<string, string>, pass: string) {
  const base = Object.entries(params)
    .filter(([k, v]) => k !== "signature" && v !== "" && v != null)
    .map(([k, v]) => `${k}=${encodeURIComponent(v.trim()).replace(/%20/g, "+")}`)
    .join("&");
  const withPass = pass
    ? `${base}&passphrase=${encodeURIComponent(pass.trim()).replace(/%20/g, "+")}`
    : base;
  return createHash("md5").update(withPass).digest("hex");
}

function launchFields(sku: string, cents: number, userId: string) {
  const amount = (cents / 100).toFixed(2);
  const f: Record<string, string> = {
    merchant_id: "10000100",
    merchant_key: "46f0cd694581a",
    return_url: "https://reson8.life/checkout/success",
    cancel_url: "https://reson8.life/checkout/cancel",
    notify_url: "https://reson8.life/api/public/payfast/itn",
    m_payment_id: `${userId}:${sku}:fixed`,
    amount,
    item_name: sku,
    item_description: sku,
    custom_str1: userId,
    custom_str2: sku,
  };
  f.signature = sig(f, "testpassphrase");
  return f;
}

function itnGuard(body: Record<string, string>, expected: number) {
  const sigOk = !!body.signature &&
    body.signature.toLowerCase() === sig(body, "testpassphrase").toLowerCase();
  if (!sigOk) return { ok: false, reason: "invalid_signature" as const };
  const got = body.amount_gross
    ? Math.round(parseFloat(body.amount_gross) * 100) : null;
  if (got !== expected)
    return { ok: false, reason: "amount_mismatch" as const, got };
  return { ok: true as const, cents: got };
}

type TierReport = {
  sku: string;
  tier: Tier;
  canonicalCents: number;
  canonicalZar: string;
  hubCatalogCents: number;
  itnCatalogCents: number;
  pricingLabel: string;
  launchAmount: string;
  itnAccept: { passed: boolean; detail: string };
  itnReject: { passed: boolean; detail: string };
  assertions: { passed: number; failed: number; total: number };
  checks: { name: string; ok: boolean; detail: string }[];
};

const tiers: TierReport[] = [];
let totalPassed = 0, totalFailed = 0;

for (const tier of EPUB_TIERS) {
  const sku = `epublisher:${tier}:monthly`;
  const hub = hubAmount(tier);
  const itn = itnAmount(tier);
  const labelStr = pricingLabel(tier);
  const labelCents = Number(labelStr.replace("R", "")) * 100;
  const fields = launchFields(sku, hub, "test-user-id");

  const okItn = { ...fields, payment_status: "COMPLETE",
    pf_payment_id: "pf-" + tier, amount_gross: (hub / 100).toFixed(2) };
  okItn.signature = sig(okItn, "testpassphrase");
  const accept = itnGuard(okItn, hub);

  const badItn = { ...okItn, amount_gross: "1.00" };
  badItn.signature = sig(badItn, "testpassphrase");
  const reject = itnGuard(badItn, hub);

  const checks = [
    { name: "Hub catalog === ITN catalog",
      ok: hub === itn,
      detail: `hub=${hub}¢ itn=${itn}¢` },
    { name: "Pricing page label matches catalog",
      ok: hub === labelCents,
      detail: `label="${labelStr}" (${labelCents}¢) vs catalog ${hub}¢` },
    { name: "Launch payload amount correct",
      ok: fields.amount === (hub / 100).toFixed(2),
      detail: `amount="${fields.amount}"` },
    { name: "ITN with matching amount accepted",
      ok: accept.ok && (accept as any).cents === hub,
      detail: accept.ok ? `accepted ${(accept as any).cents}¢` : `rejected: ${JSON.stringify(accept)}` },
    { name: "ITN with tampered amount rejected",
      ok: !reject.ok && (reject as any).reason === "amount_mismatch",
      detail: !reject.ok ? `rejected (${(reject as any).reason})` : `unexpectedly accepted` },
  ];

  const passed = checks.filter(c => c.ok).length;
  const failed = checks.length - passed;
  totalPassed += passed;
  totalFailed += failed;

  tiers.push({
    sku, tier,
    canonicalCents: hub,
    canonicalZar: `R${(hub / 100).toFixed(2)}`,
    hubCatalogCents: hub,
    itnCatalogCents: itn,
    pricingLabel: labelStr,
    launchAmount: fields.amount,
    itnAccept: { passed: checks[3].ok, detail: checks[3].detail },
    itnReject: { passed: checks[4].ok, detail: checks[4].detail },
    assertions: { passed, failed, total: checks.length },
    checks,
  });
}

const generatedAt = new Date().toISOString();
const report = {
  generatedAt,
  app: "ePublisher",
  passphrase: "testpassphrase (sandbox)",
  totals: {
    tiers: tiers.length,
    assertionsPassed: totalPassed,
    assertionsFailed: totalFailed,
    overall: totalFailed === 0 ? "PASS" : "FAIL",
  },
  tiers,
};

mkdirSync("/mnt/documents", { recursive: true });
writeFileSync(
  "/mnt/documents/epublisher-checkout-report.json",
  JSON.stringify(report, null, 2),
);

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const tierRows = tiers.map(t => `
  <tr>
    <td><code>${esc(t.sku)}</code></td>
    <td class="num">${t.canonicalZar}<br><span class="muted">${t.canonicalCents}¢</span></td>
    <td class="num">${t.hubCatalogCents}¢</td>
    <td class="num">${t.itnCatalogCents}¢</td>
    <td class="num">${esc(t.pricingLabel)}</td>
    <td class="num">R${t.launchAmount}</td>
    <td class="${t.itnAccept.passed ? "ok" : "bad"}">${t.itnAccept.passed ? "ACCEPT ✓" : "FAIL ✗"}<br><span class="muted">${esc(t.itnAccept.detail)}</span></td>
    <td class="${t.itnReject.passed ? "ok" : "bad"}">${t.itnReject.passed ? "REJECT ✓" : "FAIL ✗"}<br><span class="muted">${esc(t.itnReject.detail)}</span></td>
    <td class="num"><strong>${t.assertions.passed}/${t.assertions.total}</strong>${t.assertions.failed ? ` <span class="bad">(${t.assertions.failed} failed)</span>` : ""}</td>
  </tr>`).join("");

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>ePublisher checkout verification report</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; max-width: 1100px; margin: 2rem auto; padding: 0 1rem; }
  h1 { font-size: 1.4rem; margin-bottom: .25rem; }
  .meta { color: #666; font-size: .85rem; margin-bottom: 1.25rem; }
  .summary { display: flex; gap: 1rem; margin-bottom: 1.25rem; flex-wrap: wrap; }
  .pill { padding: .4rem .8rem; border-radius: 999px; font-weight: 600; }
  .pass { background: #d4f5dd; color: #08621e; }
  .fail { background: #fcd6d6; color: #8a1313; }
  .neutral { background: #eef0f3; color: #333; }
  table { width: 100%; border-collapse: collapse; font-size: .85rem; }
  th, td { padding: .5rem .6rem; border-bottom: 1px solid #e3e6ea; text-align: left; vertical-align: top; }
  th { background: #f6f7f9; font-weight: 600; }
  td.num { white-space: nowrap; font-variant-numeric: tabular-nums; }
  code { font: 12px ui-monospace, Menlo, monospace; }
  .ok { color: #08621e; font-weight: 600; }
  .bad { color: #8a1313; font-weight: 600; }
  .muted { color: #888; font-size: .75rem; font-weight: 400; }
  details { margin-top: 1.25rem; }
  details pre { background: #f6f7f9; padding: .75rem; border-radius: 6px; overflow: auto; font-size: 12px; }
</style>
</head>
<body>
  <h1>ePublisher checkout verification report</h1>
  <div class="meta">Generated ${esc(generatedAt)} · passphrase: ${esc(report.passphrase)}</div>
  <div class="summary">
    <span class="pill ${totalFailed === 0 ? "pass" : "fail"}">${report.totals.overall}</span>
    <span class="pill neutral">${tiers.length} tiers</span>
    <span class="pill pass">${totalPassed} passed</span>
    <span class="pill ${totalFailed === 0 ? "neutral" : "fail"}">${totalFailed} failed</span>
  </div>
  <table>
    <thead>
      <tr>
        <th>SKU</th>
        <th>Canonical</th>
        <th>Hub catalog</th>
        <th>ITN catalog</th>
        <th>Pricing label</th>
        <th>Launch amount</th>
        <th>ITN accept (matching)</th>
        <th>ITN reject (tampered R1.00)</th>
        <th>Assertions</th>
      </tr>
    </thead>
    <tbody>${tierRows}
    </tbody>
  </table>
  <details>
    <summary>Raw JSON</summary>
    <pre>${esc(JSON.stringify(report, null, 2))}</pre>
  </details>
</body>
</html>`;

writeFileSync("/mnt/documents/epublisher-checkout-report.html", html);

console.log(`Report written:
  /mnt/documents/epublisher-checkout-report.json
  /mnt/documents/epublisher-checkout-report.html
Overall: ${report.totals.overall} (${totalPassed} passed, ${totalFailed} failed)`);

if (totalFailed > 0) process.exit(1);
