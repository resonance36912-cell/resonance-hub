import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dir, "../..");

const read = (path: string) => readFileSync(resolve(repoRoot, path), "utf8");

describe("RONSAS production sovereign build boundary", () => {
  test("retires legacy MCP routes and Lovable project metadata", () => {
    for (const path of [
      ".lovable",
      "src/routes/mcp.ts",
      "src/routes/[.mcp]",
      "src/routes/[.well-known]/oauth-protected-resource.ts",
    ]) expect(existsSync(resolve(repoRoot, path))).toBe(false);
  });

  test("keeps only the governed Nova and DataNest MCP runtime", () => {
    const source = read("src/lib/mcp/index.ts");
    expect(source).toContain("defineMcp");
    expect(source).toContain("GOVERNED_MCP_TOOL_NAMES");
    expect(source).toContain("auth.oauth.issuer");
    expect(source).toContain('name: "ronsas-nova-datanest-mcp"');
  });

  test("does not declare the retired MCP SDK or npm lock and pins the governed runtime", () => {
    const pkg = JSON.parse(read("package.json"));
    expect(pkg.dependencies?.["@modelcontextprotocol/sdk"]).toBeUndefined();
    expect(pkg.dependencies?.["@lovable.dev/mcp-js"]).toBe("0.20.0");
    expect(existsSync(resolve(repoRoot, "package-lock.json"))).toBe(false);
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
