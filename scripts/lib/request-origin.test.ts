import { describe, expect, test } from "bun:test";
import { resolveRequestOrigin } from "../../src/lib/request-origin";

describe("visitor-facing request origin", () => {
  test("Railway public domain wins over the preview server loopback host", () => {
    const request = new Request("http://localhost:8080/", {
      headers: {
        host: "localhost:8080",
        "x-forwarded-proto": "https",
        "x-forwarded-host": "untrusted.example",
      },
    });
    expect(resolveRequestOrigin(request, "ronsas-hub-fallback-production.up.railway.app")).toBe(
      "https://ronsas-hub-fallback-production.up.railway.app",
    );
  });

  test("local and LAN deployments retain their actual host and port", () => {
    for (const host of ["localhost:3000", "127.0.0.1:3000", "192.168.1.20:3000", "[::1]:3000"]) {
      expect(resolveRequestOrigin(new Request(`http://${host}/`, { headers: { host } }))).toBe(
        `http://${host}`,
      );
    }
  });

  test("public deployments outside Railway retain the public host", () => {
    const request = new Request("http://reson8.life/", {
      headers: { host: "reson8.life", "x-forwarded-proto": "https, http" },
    });
    expect(resolveRequestOrigin(request)).toBe("https://reson8.life");
  });

  test("invalid configured domains cannot inject credentials, paths, or queries", () => {
    const request = new Request("http://localhost:8080/");
    for (const domain of [
      "user@example.com",
      "example.com/path",
      "example.com?x=1",
      "example.com#fragment",
      "https://example.com",
    ]) {
      expect(() => resolveRequestOrigin(request, domain)).toThrow();
    }
  });
});
