import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { createSovereignDb } from "../../src/integrations/sovereign/db.server.ts";

const savedFetch = globalThis.fetch;
const savedGateway = process.env.RESONANCE_SOVEREIGN_GATEWAY_URL;
beforeEach(() => {
  process.env.RESONANCE_SOVEREIGN_GATEWAY_URL = "http://127.0.0.1:58600";
});
afterEach(() => {
  globalThis.fetch = savedFetch;
  if (savedGateway === undefined) delete process.env.RESONANCE_SOVEREIGN_GATEWAY_URL;
  else process.env.RESONANCE_SOVEREIGN_GATEWAY_URL = savedGateway;
});

for (const envelope of [false, true]) {
  for (const mode of ["single", "maybeSingle"] as const) {
    for (const count of [0, 1, 2]) {
      test(`${mode}: ${count} rows, envelope=${envelope}`, async () => {
        const rows = Array.from({ length: count }, (_, i) => ({ id: String(i) }));
        globalThis.fetch = (async () =>
          Response.json(envelope ? { data: rows, count } : rows)) as typeof fetch;
        const result = await createSovereignDb().from("nova_projects").select("*")[mode]();
        const invalid = count > 1 || (mode === "single" && count === 0);
        if (invalid) {
          assert.equal(result.data, null);
          assert.ok(result.error instanceof Error);
        } else {
          assert.equal(result.error, null);
          assert.deepEqual(result.data, rows[0] ?? null);
        }
      });
    }
  }
}

test("a lost decision update cannot record a successful approval event", async () => {
  const tables: string[] = [];
  globalThis.fetch = (async (_input, init) => {
    const body = JSON.parse(String(init?.body));
    tables.push(body.table);
    return Response.json([]);
  }) as typeof fetch;
  // Same error boundary used by resolveDecisionTrayItem after its state=open update.
  async function resolveDecision() {
    const db = createSovereignDb();
    const { error } = await db
      .from("nova_decisions")
      .update({ state: "approved" })
      .eq("id", "decision-1")
      .eq("state", "open")
      .select("*")
      .single();
    if (error) throw error;
    await db.from("nova_authorization_events").insert({ allowed: true });
  }
  await assert.rejects(resolveDecision);
  assert.deepEqual(tables, ["nova_decisions"]);
});


test("sovereign database requests reject redirects without following them", async () => {
  let redirectMode: RequestRedirect | undefined;
  globalThis.fetch = (async (_input, init) => {
    redirectMode = init?.redirect;
    return new Response(null, {
      status: 302,
      headers: { Location: "https://example.invalid/not-loopback" },
    });
  }) as typeof fetch;

  const result = await createSovereignDb().from("nova_projects").select("*");
  assert.equal(redirectMode, "manual");
  assert.equal(result.data, null);
  assert.match(result.error?.message ?? "", /redirect refused \(302\)/);
});
