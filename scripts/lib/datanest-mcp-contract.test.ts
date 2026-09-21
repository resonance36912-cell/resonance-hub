import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const policy = await import("../../src/lib/mcp/policy").catch(() => null);
const indexSource = await Bun.file("src/lib/mcp/index.ts").text().catch(() => "");
const packageJson = JSON.parse(await Bun.file("package.json").text());
const viteSource = await Bun.file("vite.config.ts").text();
const toolPaths = [
  "src/lib/mcp/tools/datanest-search.ts",
  "src/lib/mcp/tools/datanest-trace.ts",
  "src/lib/mcp/tools/datanest-submit.ts",
  "src/lib/mcp/tools/datanest-pulse.ts",
  "src/lib/mcp/tools/datanest-coverage.ts",
  "src/lib/mcp/tools/nova-project-context.ts",
];

describe("DataNest/Nova MCP governed boundary", () => {
  test("pins the validated MCP runtime and enables the supported TanStack plugin", () => {
    expect(packageJson.dependencies?.["@lovable.dev/mcp-js"]).toBe("0.20.0");
    expect(viteSource).toContain('@lovable.dev/mcp-js/stacks/tanstack/vite');
    expect(viteSource).toContain("mcpPlugin()");
  });

  test("registers the complete governed tool catalog behind OAuth", () => {
    for (const name of [
      "datanest_search",
      "datanest_trace",
      "datanest_submit_memory",
      "datanest_submit_correction",
      "datanest_resonance_pulse",
      "datanest_get_coverage",
      "nova_get_project_context",
    ]) expect(indexSource).toContain(name);
    expect(indexSource).toContain("auth.oauth.issuer");
    expect(indexSource).toContain('acceptedAudiences: "authenticated"');
  });

  test("read tools are annotated read-only and write tools never expose canonical approval", async () => {
    const sources = Object.fromEntries(await Promise.all(toolPaths.map(async (path) => [path, await Bun.file(path).text()])));
    for (const path of [
      "src/lib/mcp/tools/datanest-search.ts",
      "src/lib/mcp/tools/datanest-trace.ts",
      "src/lib/mcp/tools/datanest-coverage.ts",
      "src/lib/mcp/tools/nova-project-context.ts",
    ]) {
      expect(sources[path]).toContain("readOnlyHint: true");
    }
    for (const source of Object.values(sources)) {
      expect(source).not.toContain("approveDataNestMemory");
      expect(source).not.toContain("datanest_approve_memory");
      expect(source).not.toContain("supersedeDataNestMemory");
    }
    expect(sources["src/lib/mcp/tools/datanest-submit.ts"]).toContain("submitMcpMemory");
    expect(sources["src/lib/mcp/tools/datanest-submit.ts"]).toContain("submitMcpCorrection");
    expect(sources["src/lib/mcp/tools/datanest-pulse.ts"]).toContain("recordMcpResonancePulse");
  });

  test("private artifact content requires explicit matching project membership", () => {
    expect(policy).not.toBeNull();
    if (!policy) return;
    expect(policy.canExposeMcpArtifact({
      visibility: "shareable",
      artifact_project_id: null,
      requested_project_id: null,
      is_project_member: false,
    })).toBe(true);
    expect(policy.canExposeMcpArtifact({
      visibility: "private",
      artifact_project_id: "11111111-1111-4111-8111-111111111111",
      requested_project_id: null,
      is_project_member: false,
    })).toBe(false);
    expect(policy.canExposeMcpArtifact({
      visibility: "private",
      artifact_project_id: "11111111-1111-4111-8111-111111111111",
      requested_project_id: "11111111-1111-4111-8111-111111111111",
      is_project_member: true,
    })).toBe(true);
    expect(policy.canExposeMcpArtifact({
      visibility: "private",
      artifact_project_id: "11111111-1111-4111-8111-111111111111",
      requested_project_id: "22222222-2222-4222-8222-222222222222",
      is_project_member: true,
    })).toBe(false);
  });

  test("MCP handlers never expose service-role credentials and sovereign mode fails closed", async () => {
    const domain = await Bun.file("src/lib/mcp/domain.server.ts").text();
    expect(domain).toContain('getBackendProvider() !== "supabase"');
    expect(domain).toContain("mcp_hosted_oauth_required");
    for (const path of toolPaths) {
      const source = await Bun.file(path).text();
      expect(source).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
      expect(source).not.toContain("service_role");
      expect(source).toContain("ctx.getUserId()");
    }
  });
});
