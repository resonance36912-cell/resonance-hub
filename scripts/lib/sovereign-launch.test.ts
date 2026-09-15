import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { prepareSovereignLaunch } from "../../src/lib/sovereign-launch.server";

const savedEnabled = process.env.RONS_SOVEREIGN_PROXY_ENABLED;
const savedGateway = process.env.RESONANCE_SOVEREIGN_GATEWAY_URL;
const savedBroker = process.env.RONS_LAUNCH_BROKER_URL;
const savedKeyFile = process.env.RONS_AUTH_EXCHANGE_KEY_FILE;
const originalFetch = globalThis.fetch;
let tempDir = "";

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "rons-launch-test-"));
  const keyFile = join(tempDir, "exchange-key");
  await writeFile(keyFile, "x".repeat(64), "utf8");
  process.env.RONS_SOVEREIGN_PROXY_ENABLED = "1";
  process.env.RESONANCE_SOVEREIGN_GATEWAY_URL = "http://127.0.0.1:58600";
  process.env.RONS_LAUNCH_BROKER_URL = "http://127.0.0.1:4450";
  process.env.RONS_AUTH_EXCHANGE_KEY_FILE = keyFile;
});

afterEach(async () => {
  globalThis.fetch = originalFetch;
  restoreEnv("RONS_SOVEREIGN_PROXY_ENABLED", savedEnabled);
  restoreEnv("RESONANCE_SOVEREIGN_GATEWAY_URL", savedGateway);
  restoreEnv("RONS_LAUNCH_BROKER_URL", savedBroker);
  restoreEnv("RONS_AUTH_EXCHANGE_KEY_FILE", savedKeyFile);
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
});

function request(origin = "http://hub.local", cookie = "session-token-1234567890") {
  return new Request("http://hub.local/api/sovereign/launch/epublisher", {
    method: "POST",
    headers: { Origin: origin, Cookie: `rons_sovereign_session=${cookie}` },
  });
}

describe("sovereign launch handoff", () => {
  test("is disabled unless explicitly enabled", async () => {
    delete process.env.RONS_SOVEREIGN_PROXY_ENABLED;
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      return Response.json({});
    }) as typeof fetch;
    const response = await prepareSovereignLaunch(request(), "epublisher");
    expect(response.status).toBe(404);
    expect(calls).toBe(0);
  });

  test("rejects cross-origin launch requests before network access", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      return Response.json({});
    }) as typeof fetch;
    const response = await prepareSovereignLaunch(request("https://evil.example"), "epublisher");
    expect(response.status).toBe(403);
    expect(calls).toBe(0);
  });

  test("requires the sovereign session cookie", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      return Response.json({});
    }) as typeof fetch;
    const response = await prepareSovereignLaunch(request("http://hub.local", ""), "epublisher");
    expect(response.status).toBe(401);
    expect(calls).toBe(0);
  });

  test("refuses non-loopback gateway or broker configuration", async () => {
    process.env.RESONANCE_SOVEREIGN_GATEWAY_URL = "https://gateway.example.invalid";
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      return Response.json({});
    }) as typeof fetch;
    const gatewayResponse = await prepareSovereignLaunch(request(), "epublisher");
    expect(gatewayResponse.status).toBe(503);
    expect(calls).toBe(0);

    process.env.RESONANCE_SOVEREIGN_GATEWAY_URL = "http://127.0.0.1:58600";
    process.env.RONS_LAUNCH_BROKER_URL = "https://broker.example.invalid";
    const brokerResponse = await prepareSovereignLaunch(request(), "epublisher");
    expect(brokerResponse.status).toBe(503);
    expect(calls).toBe(0);
  });

  test("issues a one-time ticket and redirects with no referrer", async () => {
    const seen: string[] = [];
    globalThis.fetch = (async (input, init) => {
      const url = String(input);
      seen.push(url);
      if (url.endsWith("/v1/auth/launch-ticket")) {
        const headers = new Headers(init?.headers);
        expect(headers.get("authorization")).toBe("Bearer session-token-1234567890");
        expect(headers.get("x-rons-exchange-key")).toBe("x".repeat(64));
        return Response.json({ ticket: "ticket-123" });
      }
      expect(url).toBe("http://127.0.0.1:4450/prepare");
      return Response.json({ code: "launch-code-123" });
    }) as typeof fetch;
    const response = await prepareSovereignLaunch(request(), "epublisher");
    expect(response.status).toBe(303);
    expect(seen).toEqual([
      "http://127.0.0.1:58600/v1/auth/launch-ticket",
      "http://127.0.0.1:4450/prepare",
    ]);
    expect(response.headers.get("location")).toBe(
      "https://www.resonanceonline.life/_rons/launch?code=launch-code-123",
    );
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
