import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..", "..");
const workspace = readFileSync(join(root, "src/routes/governance_.workspace.tsx"), "utf8");
const publicGovernance = readFileSync(join(root, "src/routes/governance.tsx"), "utf8");
const functions = readFileSync(join(root, "src/lib/governance/functions.ts"), "utf8");
const routeTree = readFileSync(join(root, "src/routeTree.gen.ts"), "utf8");

describe("governance workspace routing", () => {
  test("keeps the private workspace at /governance/workspace without nesting under the public constitution page", () => {
    expect(workspace).toContain('createFileRoute("/governance_/workspace")');
    expect(publicGovernance).toContain('createFileRoute("/governance")');
    const routeStart = routeTree.indexOf("const GovernanceWorkspaceRoute = GovernanceWorkspaceRouteImport.update({");
    expect(routeStart).toBeGreaterThanOrEqual(0);
    const routeBlock = routeTree.slice(routeStart, routeStart + 250);
    expect(routeBlock).toContain("path: '/governance/workspace'");
    expect(routeBlock).toContain("getParentRoute: () => rootRouteImport");
  });
});

describe("governance workspace security boundaries", () => {
  test("requires authentication and stays client-rendered", () => {
    expect(workspace).toContain("ssr: false");
    expect(workspace).toContain("ronsAuth.getUser()");
    expect(workspace).not.toContain("supabase.auth.");
    expect(workspace).toContain('to: "/login"');
    expect(workspace).toContain('next: "/governance/workspace"');
  });

  test("uses governed server functions instead of mutating governance tables directly", () => {
    expect(workspace).toContain("useServerFn(createGovernanceProposal)");
    expect(workspace).toContain("useServerFn(recordGovernanceDecision)");
    expect(workspace).toContain("useServerFn(registerGovernanceAgent)");
    expect(workspace).not.toMatch(/\.from\(["']governance_/);
  });

  test("keeps canonical decisions admin-gated and AI/service participants advisory", () => {
    expect(workspace).toContain("isAdmin && DECIDABLE.has(detail.proposal.status)");
    expect(workspace).toContain(
      "Admin-gated human authority. AI/service participants remain advisory.",
    );
    expect(workspace).toMatch(/They do not hold final\s+decision authority\./);
  });

  test("participant reads use the provider-neutral authenticated server boundary", () => {
    const participantFn = functions.match(
      /export const listGovernanceParticipants[\s\S]*?export const listGovernanceProposals/,
    );
    expect(participantFn).not.toBeNull();
    expect(participantFn![0]).toContain(".middleware([requireRonsAuth])");
    expect(participantFn![0]).toContain("callSovereignGovernanceProcedure");
    expect(participantFn![0]).toContain('.from("governance_participants")');
  });

  test("retains the repository Back to Hub invariant", () => {
    expect(workspace).toContain("Back to Hub");
  });
});
