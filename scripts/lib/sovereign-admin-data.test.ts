import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hasServerBackendRole } from "../../src/lib/backend-provider.server";

const savedProvider = process.env.RESONANCE_BACKEND_PROVIDER;
const savedGateway = process.env.RESONANCE_SOVEREIGN_GATEWAY_URL;
const savedKeyFile = process.env.RONS_GATEWAY_PROCEDURE_KEY_FILE;
const savedFetch = globalThis.fetch;
let tempRoot = "";

beforeEach(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), "rons-admin-data-"));
  const keyFile = join(tempRoot, "procedure.key");
  await writeFile(keyFile, "p".repeat(64), "utf8");
  process.env.RESONANCE_BACKEND_PROVIDER = "sovereign";
  process.env.RESONANCE_SOVEREIGN_GATEWAY_URL = "http://127.0.0.1:58600";
  process.env.RONS_GATEWAY_PROCEDURE_KEY_FILE = keyFile;
});
afterEach(async () => {
  globalThis.fetch = savedFetch;
  if (savedProvider === undefined) delete process.env.RESONANCE_BACKEND_PROVIDER;
  else process.env.RESONANCE_BACKEND_PROVIDER = savedProvider;
  if (savedGateway === undefined) delete process.env.RESONANCE_SOVEREIGN_GATEWAY_URL;
  else process.env.RESONANCE_SOVEREIGN_GATEWAY_URL = savedGateway;
  if (savedKeyFile === undefined) delete process.env.RONS_GATEWAY_PROCEDURE_KEY_FILE;
  else process.env.RONS_GATEWAY_PROCEDURE_KEY_FILE = savedKeyFile;
  if (tempRoot) await rm(tempRoot, { recursive: true, force: true });
});

describe("sovereign admin data boundary", () => {
  test("binds role lookup to session identity and the procedure key", async () => {
    const userId = "22222222-2222-4222-8222-222222222222";
    let requestUrl = "";
    let requestHeaders: Record<string, string> = {};
    let requestBody = "";
    globalThis.fetch = (async (input, init) => {
      requestUrl = String(input);
      requestHeaders = init?.headers as Record<string, string>;
      requestBody = String(init?.body ?? "");
      return Response.json({ result: { has_role: true } });
    }) as typeof fetch;

    await expect(hasServerBackendRole(userId, "admin", "session-token")).resolves.toBe(true);
    expect(requestUrl).toBe("http://127.0.0.1:58600/v1/db/procedure");
    expect(requestHeaders.Authorization).toBe("Bearer session-token");
    expect(requestHeaders["X-RONS-Procedure-Key"]).toBe("p".repeat(64));
    expect(JSON.parse(requestBody)).toEqual({
      name: "read_user_role",
      args: { user_id: userId, role: "admin" },
    });
  });

  test("refuses sovereign role checks without a signed-in credential", async () => {
    await expect(
      hasServerBackendRole("22222222-2222-4222-8222-222222222222", "admin"),
    ).rejects.toThrow("requires an authenticated credential");
  });

  test("refuses non-loopback sovereign gateways before network access", async () => {
    process.env.RESONANCE_SOVEREIGN_GATEWAY_URL = "http://example.com:58600";
    let called = false;
    globalThis.fetch = (async () => {
      called = true;
      return Response.json({ result: { has_role: true } });
    }) as typeof fetch;

    await expect(
      hasServerBackendRole("22222222-2222-4222-8222-222222222222", "admin", "session-token"),
    ).rejects.toThrow("loopback HTTP");
    expect(called).toBe(false);
  });
});
