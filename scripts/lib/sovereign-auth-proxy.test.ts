import { afterEach, describe, expect, test } from "bun:test";
import { handleSovereignAuthProxy } from "../../src/lib/sovereign-auth-proxy.server";

const savedEnabled = process.env.RONS_SOVEREIGN_PROXY_ENABLED;
const savedGateway = process.env.RESONANCE_SOVEREIGN_GATEWAY_URL;

afterEach(() => {
  if (savedEnabled === undefined) delete process.env.RONS_SOVEREIGN_PROXY_ENABLED;
  else process.env.RONS_SOVEREIGN_PROXY_ENABLED = savedEnabled;
  if (savedGateway === undefined) delete process.env.RESONANCE_SOVEREIGN_GATEWAY_URL;
  else process.env.RESONANCE_SOVEREIGN_GATEWAY_URL = savedGateway;
});

describe("sovereign auth same-origin proxy", () => {
  test("is disabled unless explicitly enabled", async () => {
    delete process.env.RONS_SOVEREIGN_PROXY_ENABLED;
    const response = await handleSovereignAuthProxy(
      new Request("http://hub.local/api/sovereign/auth/session"),
      "session",
    );
    expect(response.status).toBe(404);
  });

  test("captures sign-in bearer token in an httpOnly cookie and redacts it", async () => {
    process.env.RONS_SOVEREIGN_PROXY_ENABLED = "1";
    process.env.RESONANCE_SOVEREIGN_GATEWAY_URL = "http://127.0.0.1:58600";
    const mockFetch = (async () => Response.json({
      user: { id: "user-1", email: "test@example.invalid" },
      session: { local: true, access_token: "a".repeat(64), token_type: "bearer", expires_in: 86400 },
    })) as typeof fetch;
    const request = new Request("http://hub.local/api/sovereign/auth/sign-in", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "http://hub.local" },
      body: JSON.stringify({ email: "test@example.invalid", password: "test-password-123" }),
    });
    const response = await handleSovereignAuthProxy(request, "sign-in", mockFetch);
    expect(response.status).toBe(200);
    const setCookie = response.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("rons_sovereign_session=");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Strict");
    const body = await response.json() as { session: Record<string, unknown> };
    expect(body.session.access_token).toBeUndefined();
    expect(body.session.token_transport).toBe("httpOnly-cookie");
  });

  test("forwards the httpOnly cookie as a bearer token to the loopback gateway", async () => {
    process.env.RONS_SOVEREIGN_PROXY_ENABLED = "1";
    let forwarded = "";
    const mockFetch = (async (_input, init) => {
      forwarded = (init?.headers as Record<string, string>).Authorization ?? "";
      return Response.json({ user: { id: "user-1" } });
    }) as typeof fetch;
    const request = new Request("http://hub.local/api/sovereign/auth/user", {
      headers: { Cookie: "rons_sovereign_session=token-1234567890123456" },
    });
    const response = await handleSovereignAuthProxy(request, "user", mockFetch);
    expect(response.status).toBe(200);
    expect(forwarded).toBe("Bearer token-1234567890123456");
  });

  test("rejects cross-origin auth mutations before contacting the gateway", async () => {
    process.env.RONS_SOVEREIGN_PROXY_ENABLED = "1";
    let calls = 0;
    const mockFetch = (async () => { calls += 1; return Response.json({}); }) as typeof fetch;
    const request = new Request("http://hub.local/api/sovereign/auth/sign-up", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://evil.example" },
      body: JSON.stringify({ email: "test@example.invalid", password: "test-password-123" }),
    });
    const response = await handleSovereignAuthProxy(request, "sign-up", mockFetch);
    expect(response.status).toBe(403);
    expect(calls).toBe(0);
  });

  test("sign-out clears the Hub session cookie", async () => {
    process.env.RONS_SOVEREIGN_PROXY_ENABLED = "1";
    const mockFetch = (async () => Response.json({ ok: true })) as typeof fetch;
    const request = new Request("https://hub.local/api/sovereign/auth/sign-out", {
      method: "POST",
      headers: { Origin: "https://hub.local", Cookie: "rons_sovereign_session=token-1234567890123456" },
    });
    const response = await handleSovereignAuthProxy(request, "sign-out", mockFetch);
    const setCookie = response.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("Max-Age=0");
    expect(setCookie).toContain("Secure");
  });
});
