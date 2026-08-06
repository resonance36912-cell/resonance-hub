import { describe, it, expect } from "vitest";
import {
  validateAdminOrigin,
  normalizeAdminOriginOrThrow,
} from "../../src/lib/admin-origin-validation";

describe("validateAdminOrigin", () => {
  it("normalizes https URLs to a bare lowercase origin", () => {
    for (const input of [
      "https://app.example.com",
      "https://app.example.com/",
      "https://APP.EXAMPLE.COM/deep/path?x=1#frag",
      "  https://app.example.com/  ",
    ]) {
      const v = validateAdminOrigin(input);
      expect(v.ok && v.origin).toBe("https://app.example.com");
    }
  });

  it("keeps explicit non-default ports", () => {
    const v = validateAdminOrigin("https://app.example.com:8443/x");
    expect(v.ok && v.origin).toBe("https://app.example.com:8443");
  });

  it("flags discarded path/query/fragment", () => {
    expect(validateAdminOrigin("https://a.example/x?y=1")).toMatchObject({
      ok: true,
      hadExtraParts: true,
    });
    expect(validateAdminOrigin("https://a.example/")).toMatchObject({
      ok: true,
      hadExtraParts: false,
    });
  });

  it("rejects non-HTTPS origins", () => {
    expect(validateAdminOrigin("http://app.example.com")).toMatchObject({
      ok: false,
      code: "insecure_scheme",
    });
  });

  it("allows http for loopback hosts only", () => {
    expect(validateAdminOrigin("http://localhost:5173")).toMatchObject({
      ok: true,
      origin: "http://localhost:5173",
    });
    expect(validateAdminOrigin("http://127.0.0.1:3000")).toMatchObject({
      ok: true,
    });
  });

  it("rejects non-http(s) schemes", () => {
    for (const bad of [
      "javascript:alert(1)",
      "data:text/html,<script>1</script>",
      "ftp://a.example",
      "file:///etc/passwd",
    ]) {
      expect(validateAdminOrigin(bad).ok).toBe(false);
    }
  });

  it("rejects malformed, empty, wildcard and whitespace input", () => {
    expect(validateAdminOrigin("").ok).toBe(false);
    expect(validateAdminOrigin("/account")).toMatchObject({ code: "malformed" });
    expect(validateAdminOrigin("app.example.com")).toMatchObject({
      code: "malformed",
    });
    expect(validateAdminOrigin("https://*.example.com")).toMatchObject({
      code: "wildcard",
    });
    expect(validateAdminOrigin("https://a.example/\nb")).toMatchObject({
      code: "whitespace",
    });
  });

  it("rejects userinfo and over-long values", () => {
    expect(validateAdminOrigin("https://user:pass@a.example/")).toMatchObject({
      code: "userinfo",
    });
    expect(
      validateAdminOrigin(`https://a.example/${"x".repeat(400)}`),
    ).toMatchObject({ code: "too_long" });
  });

  it("throwing variant mirrors the verdict", () => {
    expect(normalizeAdminOriginOrThrow("https://A.example/x")).toBe(
      "https://a.example",
    );
    expect(() => normalizeAdminOriginOrThrow("http://a.example")).toThrow(
      /Only https/,
    );
  });
});
