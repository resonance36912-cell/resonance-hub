import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");

describe("RONSAS production sovereign build boundary", () => {
  test("retires embedded MCP and Lovable project metadata", () => {
    for (const path of [
      ".lovable",
      "src/lib/mcp",
      "src/routes/mcp.ts",
      "src/routes/[.mcp]",
      "src/routes/[.well-known]/oauth-protected-resource.ts",
    ]) expect(existsSync(path)).toBe(false);
  });

  test("does not declare the retired MCP SDK or npm lock", () => {
    const pkg = JSON.parse(read("package.json"));
    expect(pkg.dependencies?.["@modelcontextprotocol/sdk"]).toBeUndefined();
    expect(existsSync("package-lock.json")).toBe(false);
  });

  test("uses canonical Supabase authority without Lovable redirect", () => {
    const config = read("supabase/config.toml");
    expect(config).toContain('project_id = "sussqbrajaopfoehquje"');
    expect(config).not.toContain("resonance-hub.lovable.app");
  });

  test("uses RONSAS CI naming and native Bun execution", () => {
    const workflow = read(".github/workflows/verify-prebuild.yml");
    expect(workflow).toContain("RONSAS_SUPABASE_ACCESS_TOKEN");
    expect(workflow).not.toContain("LOVABLE_BROWSER_SUPABASE_ACCESS_TOKEN");
    expect(workflow).not.toContain("bunx ");
  });
});
