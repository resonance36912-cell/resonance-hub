import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("RONSAS sovereign build and tool boundary", () => {
  it("does not depend on Lovable MCP or build packages", () => {
    const pkg = read("package.json");
    const bunfig = read("bunfig.toml");
    expect(pkg).not.toContain("@lovable.dev/mcp-js");
    expect(pkg).not.toContain("@lovable.dev/vite-tanstack-config");
    expect(bunfig).not.toContain("@lovable.dev");
  });

  it("uses the provider-neutral Vite/TanStack/Nitro build path", () => {
    const vite = read("vite.config.ts");
    expect(vite).toContain('from "vite"');
    expect(vite).toContain('from "@tanstack/react-start/plugin/vite"');
    expect(vite).toContain('from "nitro/vite"');
    expect(vite).toContain('nitro({ preset: "node-server" })');
    expect(vite).not.toContain("@lovable.dev");
  });

  it("retires the embedded public MCP compatibility routes", () => {
    for (const path of [
      "src/routes/mcp.ts",
      "src/routes/[.mcp]/list-tools.ts",
      "src/routes/[.mcp]/invoke-tool/$tool.ts",
      "src/routes/[.well-known]/oauth-protected-resource.ts",
      "src/lib/mcp/index.ts",
      ".lovable/project.json",
    ]) {
      expect(existsSync(resolve(process.cwd(), path))).toBe(false);
    }
    expect(read("src/routeTree.gen.ts")).not.toMatch(/\/mcp|\/\.mcp|oauth-protected-resource/);
    expect(read("src/lib/routes.ts")).not.toContain('routePath("/mcp")');
  });

  it("does not permit Lovable origins in the browser security boundary", () => {
    const headers = read("src/lib/security-headers.ts");
    expect(headers).not.toMatch(/lovable\.app|lovable\.dev|lovableproject\.com/i);
  });

  it("uses only canonical RONSAS hosts in active redirect and subscription config", () => {
    const combined = [
      read("src/lib/return-to-allowlist.ts"),
      read("src/lib/subscriptions.functions.ts"),
      read("supabase/config.toml"),
      read("scripts/smoke-hub-routes.ts"),
    ].join("\n");
    expect(combined).not.toContain(".lovable.app");
    expect(combined).toContain("https://youtube.reson8.life");
    expect(combined).toContain("https://reson8.life");
  });
});
