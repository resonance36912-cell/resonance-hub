import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  fetchAccountInvoiceRows,
  fetchBillingAccountRows,
  fetchSubscriptionDetails,
} from "../../src/lib/backend-provider.server";

const savedFetch = globalThis.fetch;
const savedProvider = process.env.RESONANCE_BACKEND_PROVIDER;
const savedGateway = process.env.RESONANCE_SOVEREIGN_GATEWAY_URL;
const savedKeyPath = process.env.RONS_GATEWAY_PROCEDURE_KEY_FILE;
const temp = mkdtempSync(join(tmpdir(), "rons-billing-provider-"));
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
function enableSovereign() {
  process.env.RESONANCE_BACKEND_PROVIDER = "sovereign";
  process.env.RESONANCE_SOVEREIGN_GATEWAY_URL = "http://127.0.0.1:58600";
  process.env.RONS_GATEWAY_PROCEDURE_KEY_FILE = keyPath;
}

function installProcedureMock(seen: any[]) {
  globalThis.fetch = (async (input, init) => {
    const headers = new Headers(init?.headers);
    const body = JSON.parse(String(init?.body ?? "{}"));
    seen.push({ url: String(input), body, key: headers.get("x-rons-procedure-key"), auth: headers.get("authorization") });
    if (body.name === "read_account_invoices") return Response.json({ procedure: body.name, rows: [] });
    if (body.name === "read_billing_account") return Response.json({ procedure: body.name, wallets: [], receipts: [] });
    if (body.name === "read_subscription_account") return Response.json({ procedure: body.name, rows: [] });
    return Response.json({ procedure: body.name, rows: [] });
  }) as typeof fetch;
}

describe("billing provider boundary", () => {
  test("invoice and billing server functions use RONS auth without Supabase context coupling", () => {
    for (const rel of ["src/lib/invoices.functions.ts", "src/lib/billing-portal.functions.ts"]) {
      const source = readFileSync(rel, "utf8");
      expect(source).toContain("requireRonsAuth");
      expect(source).not.toContain("requireSupabaseAuth");
      expect(source).not.toMatch(/\b(?:context|ctx)\.supabase\b/);
    }
  });
  test("sovereign account billing reads use only keyed loopback procedures", async () => {
    enableSovereign();
    const seen: any[] = [];
    installProcedureMock(seen);
    const userId = "22222222-2222-4222-8222-222222222222";
    expect(await fetchAccountInvoiceRows("session-token", userId)).toEqual([]);
    expect(await fetchBillingAccountRows("session-token", userId)).toEqual({ wallets: [], receipts: [] });
    expect(seen.map((x) => x.body.name)).toEqual(["read_account_invoices", "read_billing_account"]);
    for (const call of seen) {
      expect(call.url).toBe("http://127.0.0.1:58600/v1/db/procedure");
      expect(call.key).toHaveLength(64);
      expect(call.auth).toBeNull();
      expect(call.body.args.user_id).toBe(userId);
    }
  });

  test("procedure key is never sent to a non-loopback gateway", async () => {
    enableSovereign();
    process.env.RESONANCE_SOVEREIGN_GATEWAY_URL = "https://example.invalid";
    let called = false;
    globalThis.fetch = (async () => { called = true; return Response.json({}); }) as typeof fetch;
    await expect(fetchBillingAccountRows("session-token", "22222222-2222-4222-8222-222222222222"))
      .rejects.toThrow("loopback HTTP");
    expect(called).toBe(false);
  });

  test("subscription details use the protected account procedure in sovereign mode", async () => {
    enableSovereign();
    const seen: any[] = [];
    installProcedureMock(seen);
    const userId = "22222222-2222-4222-8222-222222222222";
    expect(await fetchSubscriptionDetails("session-token", userId)).toEqual([]);
    expect(seen).toHaveLength(1);
    expect(seen[0].body).toEqual({ name: "read_subscription_account", args: { user_id: userId } });
    const source = readFileSync("src/lib/backend-provider.server.ts", "utf8");
    expect(source).toContain('"read_subscription_account"');
  });
});