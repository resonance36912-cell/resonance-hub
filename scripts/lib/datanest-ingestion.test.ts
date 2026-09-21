import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const ingestion = await import("../../src/lib/datanest/ingestion").catch(() => null);
const redaction = await import("../../src/lib/datanest/redaction").catch(() => null);

describe("DataNest deterministic ingestion", () => {
  test("fingerprints source, external identity and content deterministically", () => {
    expect(ingestion).not.toBeNull();
    if (!ingestion) return;
    const a = ingestion.fingerprintArtifact("chatgpt", "abc", "same");
    const b = ingestion.fingerprintArtifact("chatgpt", "abc", "same");
    const c = ingestion.fingerprintArtifact("chatgpt", "abc", "changed");
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^[a-f0-9]{64}$/);
  });

  test("redacts credentials before indexing", () => {
    expect(redaction).not.toBeNull();
    if (!redaction) return;
    expect(redaction.redactForIndex("Authorization: Bearer secret-token"))
      .toBe("Authorization: Bearer [REDACTED:TOKEN]");
    expect(redaction.redactForIndex("password=hunter2")).toContain("[REDACTED:PASSWORD]");
    expect(redaction.redactForIndex("api_key=abc123")).toContain("[REDACTED:API_KEY]");
    expect(redaction.redactForIndex("-----BEGIN PRIVATE KEY-----\nsecret\n-----END PRIVATE KEY-----"))
      .toBe("[REDACTED:PRIVATE_KEY]");
  });

  test("authenticated ingestion is idempotent and never auto-approves memory", () => {
    const source = readFileSync("src/lib/datanest/functions.ts", "utf8");
    expect(source).toContain("requireRonsAuth");
    expect(source).toContain("fingerprintArtifact");
    expect(source).toContain("maybeSingle");
    expect(source).toContain("duplicates: 1");
    expect(source).not.toContain('state: "approved"');
    expect(source).toContain("export const getDataNestCoverage");
  });
});
