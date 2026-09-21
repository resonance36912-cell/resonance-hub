import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createSovereignDb } from "../../src/integrations/sovereign/db.server";

const savedFetch = globalThis.fetch;
const savedGateway = process.env.RESONANCE_SOVEREIGN_GATEWAY_URL;
const savedKey = process.env.RONS_GATEWAY_PROCEDURE_KEY_FILE;

afterEach(() => {
  globalThis.fetch = savedFetch;
  if (savedGateway === undefined) delete process.env.RESONANCE_SOVEREIGN_GATEWAY_URL;
  else process.env.RESONANCE_SOVEREIGN_GATEWAY_URL = savedGateway;
  if (savedKey === undefined) delete process.env.RONS_GATEWAY_PROCEDURE_KEY_FILE;
  else process.env.RONS_GATEWAY_PROCEDURE_KEY_FILE = savedKey;
});

describe("sovereign Nova/DataNest DB adapter", () => {
  test("routes select filters through the loopback gateway", async () => {
    process.env.RESONANCE_SOVEREIGN_GATEWAY_URL = "http://127.0.0.1:58600";
    let body: any;
    globalThis.fetch = (async (input, init) => {
      expect(String(input)).toBe("http://127.0.0.1:58600/v1/db/query");
      body = JSON.parse(String(init?.body ?? "{}"));
      return Response.json([{ id: "row-1", state: "active" }]);
    }) as typeof fetch;

    const db = createSovereignDb();
    const result = await db.from("nova_projects")
      .select("id,state")
      .in("state", ["active", "paused"])
      .limit(10);

    expect(result.error).toBeNull();
    expect(result.data).toEqual([{ id: "row-1", state: "active" }]);
    expect(body).toMatchObject({
      table: "nova_projects",
      action: "select",
      columns: "id,state",
      filters: [{ column: "state", op: "in", value: ["active", "paused"] }],
      options: { limit: 10 },
    });
  });

  test("sends governed procedures with the local procedure key", async () => {
    process.env.RESONANCE_SOVEREIGN_GATEWAY_URL = "http://localhost:58600";
    const keyPath = join(tmpdir(), `rons-db-adapter-${crypto.randomUUID()}.key`);
    await Bun.write(keyPath, "p".repeat(64));
    process.env.RONS_GATEWAY_PROCEDURE_KEY_FILE = keyPath;

    let body: any;
    globalThis.fetch = (async (input, init) => {
      expect(String(input)).toBe("http://localhost:58600/v1/db/procedure");
      expect(new Headers(init?.headers).get("x-rons-procedure-key")).toBe("p".repeat(64));
      body = JSON.parse(String(init?.body ?? "{}"));
      return Response.json({ procedure: "nova_transition_job", job: { id: "job-1", state: "running" } });
    }) as typeof fetch;

    const result = await createSovereignDb().rpc("nova_transition_job", {
      p_job_id: "11111111-1111-4111-8111-111111111111",
      p_expected_version: 1,
      p_next_state: "running",
      p_actor_user_id: "22222222-2222-4222-8222-222222222222",
      p_reason: "test",
    });

    expect(result.error).toBeNull();
    expect(result.data).toEqual({ id: "job-1", state: "running" });
    expect(body.name).toBe("nova_transition_job");
  });

  test("rejects non-loopback gateway URLs before network access", async () => {
    process.env.RESONANCE_SOVEREIGN_GATEWAY_URL = "https://example.com";
    let called = false;
    globalThis.fetch = (async () => {
      called = true;
      return Response.json([]);
    }) as typeof fetch;

    const result = await createSovereignDb().from("nova_projects").select("id");
    expect(result.error?.message).toContain("loopback HTTP");
    expect(called).toBe(false);
  });

  test("Nova and DataNest functions select the sovereign adapter explicitly", async () => {
    const nova = await Bun.file("src/lib/nova/functions.ts").text();
    const datanest = await Bun.file("src/lib/datanest/functions.ts").text();
    for (const source of [nova, datanest]) {
      expect(source).toContain('getBackendProvider() === "sovereign"');
      expect(source).toContain("createSovereignDb()");
    }
  });
});
