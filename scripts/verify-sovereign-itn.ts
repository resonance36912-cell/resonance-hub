#!/usr/bin/env bun
import { readFileSync } from "node:fs";

type Check = { label: string; ok: boolean; detail?: string };

const itn = readFileSync("src/routes/api/public/payfast/itn.ts", "utf8");
const provider = readFileSync("src/lib/backend-provider.server.ts", "utf8");
const checks: Check[] = [];

const sovereignBranch = itn.indexOf('if (getBackendProvider() === "sovereign")');
const hostedClaim = itn.indexOf('.from("webhook_events")');
const settleCall = itn.indexOf("await settlePayfastItn({");
const settleReturn = itn.indexOf("return new Response(settled.response_body");
const payloadHash = itn.indexOf('const payloadHash = createHash("sha256")');
const signatureGuard = itn.indexOf("const expectedSig = buildSignature");
const hostedLogInsert = itn.indexOf('supabaseAdmin.from("payfast_itn_logs").insert(hostedRow)');
const sovereignLogCall = itn.indexOf("await recordPayfastItnAttempt({");

const hostedRowStart = itn.indexOf("const hostedRow = {");
const hostedRowEnd = hostedRowStart >= 0 ? itn.indexOf("};", hostedRowStart) : -1;
const hostedRowBlock = hostedRowStart >= 0 && hostedRowEnd > hostedRowStart
  ? itn.slice(hostedRowStart, hostedRowEnd)
  : "";

const auditFnStart = provider.indexOf("export async function recordPayfastItnAttempt");
const auditFnEnd = auditFnStart >= 0 ? provider.indexOf("export async function settlePayfastItn", auditFnStart) : -1;
const auditFnBlock = auditFnStart >= 0 && auditFnEnd > auditFnStart
  ? provider.slice(auditFnStart, auditFnEnd)
  : "";

const settleFnStart = provider.indexOf("export async function settlePayfastItn");
const settleFnEnd = settleFnStart >= 0 ? provider.indexOf("export async function recordPayfastLaunchAudit", settleFnStart) : -1;
const settleFnBlock = settleFnStart >= 0 && settleFnEnd > settleFnStart
  ? provider.slice(settleFnStart, settleFnEnd)
  : "";

checks.push(
  {
    label: "ITN imports the sovereign backend provider and v0.11 procedures",
    ok: itn.includes("getBackendProvider")
      && itn.includes("recordPayfastItnAttempt")
      && itn.includes("settlePayfastItn")
      && itn.includes('from "@/lib/backend-provider.server"'),
  },
  {
    label: "payload hash is computed before signature validation so failed attempts can be sanitized",
    ok: payloadHash >= 0 && signatureGuard > payloadHash,
  },
  {
    label: "sovereign settlement branch occurs before hosted webhook claim",
    ok: sovereignBranch >= 0 && hostedClaim > sovereignBranch,
  },
  {
    label: "sovereign branch settles and returns before hosted webhook claim",
    ok: settleCall > sovereignBranch && settleReturn > settleCall && settleReturn < hostedClaim,
  },
  {
    label: "hosted ITN log fallback remains available after provider split",
    ok: hostedLogInsert >= 0,
  },
  {
    label: "sovereign ITN audit uses the keyed backend adapter",
    ok: sovereignLogCall >= 0,
  },
  {
    label: "sovereign ITN log sends payload hash but never raw payload",
    ok: (() => {
      const start = sovereignLogCall;
      const end = start >= 0 ? itn.indexOf("});", start) : -1;
      if (start < 0 || end < 0) return false;
      const block = itn.slice(start, end);
      return block.includes("payload_hash: row.payload_hash") && !block.includes("raw_payload");
    })(),
  },
  {
    label: "hosted log excludes sovereign-only payload_hash column",
    ok: hostedRowBlock.includes("raw_payload: row.raw_payload")
      && !hostedRowBlock.includes("payload_hash:"),
  },
  {
    label: "sovereign settlement validates SKU before calling backend",
    ok: sovereignBranch >= 0 && itn.indexOf("if (!def)", sovereignBranch) > sovereignBranch
      && itn.indexOf("if (!def)", sovereignBranch) < settleCall,
  },
  {
    label: "sovereign settlement validates user before calling backend",
    ok: sovereignBranch >= 0 && itn.indexOf("if (!userId)", sovereignBranch) > sovereignBranch
      && itn.indexOf("if (!userId)", sovereignBranch) < settleCall,
  },
  {
    label: "sovereign settlement validates exact catalog amount before calling backend",
    ok: sovereignBranch >= 0 && itn.indexOf("if (grossCents !== def.amountCents)", sovereignBranch) > sovereignBranch
      && itn.indexOf("if (grossCents !== def.amountCents)", sovereignBranch) < settleCall,
  },
  {
    label: "settlement payload contains every v0.11 required field",
    ok: [
      "event_id: eventId",
      "payload_hash: payloadHash",
      "sku,",
      "user_id: userId",
      "app: def.app",
      "tier: def.tier",
      "amount_cents: def.amountCents",
      'currency: "ZAR"',
      "billing_cycle: def.cycle",
      'payment_status: paymentStatus ?? "PENDING"',
      "pf_payment_id: pfPaymentId",
      "m_payment_id: mPaymentId",
      "payfast_token: params.token ?? null",
      "recipient_email: params.email_address ?? null",
      "source_ip: sourceIp",
    ].every((needle) => itn.slice(settleCall, settleReturn).includes(needle)),
  },
  {
    label: "sovereign recipient email comes from the signed/validated PayFast field",
    ok: itn.includes("recipient_email: params.email_address ?? null"),
  },
  {
    label: "backend provider exposes exact keyed ITN procedure names",
    ok: provider.includes('"record_payfast_itn_attempt"')
      && provider.includes('"settle_payfast_itn"')
      && provider.includes("recordPayfastItnAttempt")
      && provider.includes("settlePayfastItn"),
  },
  {
    label: "backend provider refuses ITN procedures outside sovereign mode",
    ok: auditFnBlock.includes('getBackendProvider() !== "sovereign"')
      && settleFnBlock.includes('getBackendProvider() !== "sovereign"'),
  },
  {
    label: "procedure transport remains loopback and key-protected",
    ok: provider.includes('"X-RONS-Procedure-Key": key')
      && provider.includes("Sovereign procedure gateway must be loopback HTTP"),
  },
);

const failed = checks.filter((check) => !check.ok);
for (const check of checks) {
  console.log(`${check.ok ? "✓" : "✗"} ${check.label}${check.detail ? ` — ${check.detail}` : ""}`);
}
if (failed.length) {
  console.error(`\nverify-sovereign-itn failed: ${failed.length} invariant(s) violated.`);
  process.exit(1);
}
console.log("\n✓ sovereign PayFast ITN boundary invariants hold.");
