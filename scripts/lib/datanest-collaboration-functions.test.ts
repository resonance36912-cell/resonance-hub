import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..", "..");
const contractsPath = join(root, "src/lib/datanest/collaboration.contracts.ts");
const functionsPath = join(root, "src/lib/datanest/collaboration.functions.ts");
const contracts = existsSync(contractsPath) ? readFileSync(contractsPath, "utf8") : "";
const functions = existsSync(functionsPath) ? readFileSync(functionsPath, "utf8") : "";

describe("DataNest collaboration server boundary", () => {
  test("defines the collaboration contracts and server functions", () => {
    expect(existsSync(contractsPath)).toBe(true);
    expect(existsSync(functionsPath)).toBe(true);
  });

  test("authenticates every exported server function", () => {
    for (const name of [
      "listDataNestCollaborationProjects",
      "getDataNestCollaborationProject",
      "addDataNestProjectMember",
      "removeDataNestProjectMember",
      "attachDataNestIntegration",
      "revokeDataNestIntegration",
      "attachDataNestDevice",
      "detachDataNestDevice",
    ]) {
      const start = functions.indexOf(`export const ${name}`);
      expect(start).toBeGreaterThan(-1);
      expect(functions.slice(start, start + 900)).toContain(".middleware([requireRonsAuth])");
    }
  });

  test("rejects secret-bearing integration metadata and references", async () => {
    if (!existsSync(contractsPath)) {
      expect(existsSync(contractsPath)).toBe(true);
      return;
    }
    const mod = await import("../../src/lib/datanest/collaboration.contracts");
    const base = {
      project_id: "11111111-1111-4111-8111-111111111111",
      provider: "github" as const,
      display_name: "RONSAS",
      external_ref: "resonance36912-cell/RONSAS",
      metadata: {},
    };
    expect(() =>
      mod.AttachIntegrationInput.parse({ ...base, metadata: { access_token: "never-store" } }),
    ).toThrow("credential_metadata_forbidden");
    expect(() =>
      mod.AttachIntegrationInput.parse({
        ...base,
        external_ref: "https://token:secret@example.invalid/repo",
      }),
    ).toThrow("credential_reference_forbidden");
  });

  test("rejects owner role assignment through member mutation", async () => {
    if (!existsSync(contractsPath)) {
      expect(existsSync(contractsPath)).toBe(true);
      return;
    }
    const mod = await import("../../src/lib/datanest/collaboration.contracts");
    expect(() =>
      mod.AddProjectMemberInput.parse({
        project_id: "11111111-1111-4111-8111-111111111111",
        user_id: "22222222-2222-4222-8222-222222222222",
        role: "owner",
      }),
    ).toThrow();
  });

  test("protects canonical ownership and bridge visibility", () => {
    expect(functions).toContain("cannot_modify_project_owner");
    expect(functions).toContain("owner_required");
    expect(functions).toContain('.from("bridge_devices")');
    expect(functions).toContain('.from("bridge_tool_grants")');
    expect(functions).toContain('.eq("enabled", true)');
    expect(functions).toContain("device_not_available");
  });

  test("integration persistence has no credential fields", () => {
    expect(functions).not.toMatch(
      /access_token|refresh_token|password|passwd|cookie|service_role_key/i,
    );
  });
});
