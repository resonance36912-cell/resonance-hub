import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");

describe("Nova Studio route and composition boundary", () => {
  test("exposes the Nova home and project workspace routes", () => {
    const novaHome = read("src/routes/nova.index.tsx");
    const projectRoute = read("src/routes/nova.projects.$projectId.tsx");
    expect(novaHome).toContain('createFileRoute("/nova/")');
    expect(projectRoute).toContain('createFileRoute("/nova/projects/$projectId")');
    expect(projectRoute).not.toMatch(/\.from\(["']nova_/);
  });

  test("keeps the workspace composed from the approved Nova surfaces", () => {
    const shell = read("src/components/nova/NovaShell.tsx");
    expect(shell).toContain("NovaComposer");
    expect(shell).toContain("NovaDecisionTray");
    expect(shell).toContain("NovaIntelligenceRail");
    expect(shell).toContain("NovaNavigator");
    expect(shell).toContain("NovaCanvas");
  });

  test("keeps Nova outside the paid application catalog", () => {
    const registry = read("src/lib/app-registry.ts");
    expect(registry).toContain("nova_studio");
    expect(registry).toContain('url: `${HUB_URL}/nova`');
    const appRegistryBlock = registry.slice(
      registry.indexOf("export const APP_REGISTRY"),
      registry.indexOf("export type AppKey"),
    );
    expect(appRegistryBlock).not.toContain("nova_studio");
  });

  test("surfaces Nova from the Hub home without restoring billing", () => {
    const home = read("src/routes/index.tsx");
    expect(home).toContain('to="/nova"');
    expect(home).toContain("Open Nova Studio");
    expect(home).toContain("Free promotional access");
  });
});
