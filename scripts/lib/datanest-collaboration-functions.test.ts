import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..", "..");
const contracts = readFileSync(join(root, "src/lib/datanest/collaboration.contracts.ts"), "utf8");
const functions = readFileSync(join(root, "src/lib/datanest/collaboration.functions.ts"), "utf8");

describe("DataNest collaboration server boundary", () => {\n  test("uses the Hub validator API", () => {\n    expect(functions).toContain(".validator((input: unknown) =>");\n    expect(functions).not.toContain(".inputValidator(");\n  });
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
      expect(functions.slice(start, start + 700)).toContain(".middleware([requireRonsAuth])");
    }
  });

  test("never accepts credential-bearing integration metadata or credential-like references", () => {
    expect(contracts).toContain("FORBIDDEN_METADATA_KEY");
    expect(contracts).toContain("FORBIDDEN_EXTERNAL_REF");
    expect(contracts).toMatch(/access[_-]?token|refresh[_-]?token|password|cookie|secret|api[_-]?key/i);
  });

  test("owner mutations explicitly protect canonical ownership", () => {
    expect(functions).toContain("cannot_modify_project_owner");
    expect(functions).toContain("owner_required");
  });

  test("device attachment verifies bridge visibility and enabled state", () => {
    expect(functions).toContain('.from("bridge_devices")');
    expect(functions).toContain('.from("bridge_tool_grants")');
    expect(functions).toContain('.eq("enabled", true)');
    expect(functions).toContain("device_not_available");
  });

  test("read and write paths resolve membership before project data access", () => {
    expect(functions).toContain("collaborationProjectRole");
    expect(functions).toContain("requireProjectRole");
    expect(functions).toContain("requireOwner");
  });

  test("integration mutations persist no secret-bearing fields", () => {
    expect(functions).not.toMatch(/access_token|refresh_token|password|cookie|service_role_key/i);
  });
});
