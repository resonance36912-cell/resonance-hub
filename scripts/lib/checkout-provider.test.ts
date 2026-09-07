import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { recordPayfastLaunchAudit } from "../../src/lib/backend-provider.server";

const savedFetch = globalThis.fetch;
const savedProvider = process.env.RESONANCE_BACKEND_PROVIDER;
const savedGateway = process.env.RESONANCE_SOVEREIGN_GATEWAY_URL;
const savedKeyPath = process.env.RONS_GATEWAY_PROCEDURE_KEY_FILE;
const temp = mkdtempSync(join(tmpdir(), "rons-checkout-provider-"));
const keyPath = join(temp, "gateway-procedure-key");
writeFileSync(keyPath, "p".repeat(64), "utf8");

afterEach(() => {
  globalThis.fetch = savedFetch;
  if (savedProvider === undefined) delete process.env.RESONANCE_BACKEND_PROVIDER;
  else process.env.RESONANCE_BACKEND_PROVIDER = savedProvider;
  if (savedGateway === undefined) delete process.env.RESONANCE_SOVEREIGN_GATEWAY_URL;
  else process.env.RESONANCE_SOVEREIGN_GATEWAY_URL = savedGateway;
  if (savedKeyPath === undefined) delete process.env.RONS_GATEWAY_PROCEDURE_KEY_FILE;
  else process.env.RONS_GATEWAY_PROCEDURE_KEY_FILE = savedKeyPath;
});
describe("checkout provider boundary", () => {
  test("checkout uses RONS auth and no direct Supabase request context", () => {
    const source = readFileSync("src/lib/checkout.functions.ts", "utf8");
    expect(source).toContain("requireRonsAuth");
    expect(source).toContain("recordPayfastLaunchAudit");
    expect(source).toContain("fetchSubscriptionDetails");
    expect(source).not.toContain("requireSupabaseAuth");
    expect(source).not.toContain("supabaseAdmin");
    expect(source).not.toMatch(/\b(?:context|ctx)\.supabase\b/);
  });

  test("sovereign launch audit uses only the keyed loopback procedure", async () => {
    process.env.RESONANCE_BACKEND_PROVIDER = "sovereign";
    process.env.RESONANCE_SOVEREIGN_GATEWAY_URL = "http://127.0.0.1:58600";
    process.env.RONS_GATEWAY_PROCEDURE_KEY_FILE = keyPath;
    let seen: any = null;
    globalThis.fetch = (async (input, init) => {
      seen = { url: String(input), headers: new Headers(init?.headers), body: JSON.parse(String(init?.body ?? "{}")) };
      return Response.json({ procedure: "record_payfast_launch", id: "11111111-1111-4111-8111-111111111111", created_at: "2026-09-07T00:00:00Z" });
    }) as typeof fetch;
    await recordPayfastLaunchAudit({
      user_id: "22222222-2222-4222-8222-222222222222",
      sku: "all_access:creator_pass:monthly",
      m_payment_id: "demo-payment-id",
      amount_cents: 49900, currency: "ZAR",
      action_url: "https://sandbox.payfast.co.za/eng/process", sandbox: true,
      source_ip: null, user_agent: "demo-test", return_to: "http://192.168.1.50:4173/account/subscriptions",
    });
    expect(seen.url).toBe("http://127.0.0.1:58600/v1/db/procedure");
    expect(seen.headers.get("x-rons-procedure-key")).toHaveLength(64);
    expect(seen.headers.get("authorization")).toBeNull();
    expect(seen.body.name).toBe("record_payfast_launch");
    expect(seen.body.args.row.amount_cents).toBe(49900);
    const serialized = JSON.stringify(seen.body);
    expect(serialized).not.toContain("merchant_key");
    expect(serialized).not.toContain("passphrase");
    expect(serialized).not.toContain("payfast_token");
  });
});