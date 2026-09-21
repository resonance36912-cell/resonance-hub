import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "bun:test";
import {
  CreateProposalInput,
  RecordDecisionInput,
  RegisterGovernanceAgentInput,
  ReviewInput,
} from "../../src/lib/governance/contracts";

const ROOT = resolve(import.meta.dir, "../..");
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf8");
const migration = read("supabase/migrations/20260916090000_governance_workspace_core.sql");
const hardeningMigration = read("supabase/migrations/20260916114000_harden_governance_client_grants.sql");
const functions = read("src/lib/governance/functions.ts");
const backendProvider = read("src/lib/backend-provider.server.ts");

describe("governance contracts", () => {
  test("proposal input is bounded and strict", () => {
    expect(
      CreateProposalInput.parse({
        title: "Adopt governed proposal workflow",
        summary: "Introduce a durable proposal and decision record for the workspace.",
        body: "This proposal defines the first persistent governance workflow and audit boundary.",
      }).metadata,
    ).toEqual({});
    expect(() =>
      CreateProposalInput.parse({
        title: "abc",
        summary: "0123456789",
        body: "x".repeat(20),
        admin: true,
      }),
    ).toThrow();
  });

  test("human review cannot impersonate an arbitrary participant", () => {
    expect(
      ReviewInput.parse({
        proposal_id: "11111111-1111-4111-8111-111111111111",
        stance: "support",
        rationale: "The evidence supports proceeding with this governed change.",
      }).evidence_ids,
    ).toEqual([]);
    expect(() =>
      ReviewInput.parse({
        proposal_id: "11111111-1111-4111-8111-111111111111",
        participant_id: "22222222-2222-4222-8222-222222222222",
        stance: "support",
        rationale: "Attempt to claim a different identity must fail.",
      }),
    ).toThrow();
  });

  test("agent registration permits only non-human identities", () => {
    expect(
      RegisterGovernanceAgentInput.parse({
        kind: "ai",
        slug: "risk-analyst",
        display_name: "Risk Analyst",
        role_label: "Advisory risk review",
      }).kind,
    ).toBe("ai");
    expect(() =>
      RegisterGovernanceAgentInput.parse({
        kind: "human",
        slug: "fake-human",
        display_name: "Fake Human",
        role_label: "Invalid",
      }),
    ).toThrow();
  });

  test("decision input requires optimistic version and bounded rationale", () => {
    expect(
      RecordDecisionInput.parse({
        proposal_id: "11111111-1111-4111-8111-111111111111",
        expected_version: 2,
        outcome: "approved",
        rationale: "Human authority approved the proposal after review of the recorded evidence.",
      }).expected_version,
    ).toBe(2);
    expect(() =>
      RecordDecisionInput.parse({
        proposal_id: "11111111-1111-4111-8111-111111111111",
        expected_version: 0,
        outcome: "approved",
        rationale: "This must fail because version zero is invalid.",
      }),
    ).toThrow();
  });
});

describe("governance database boundary", () => {
  test("creates the durable governance entities with RLS", () => {
    for (const table of [
      "governance_participants",
      "governance_proposals",
      "governance_evidence",
      "governance_reviews",
      "governance_decisions",
      "governance_events",
    ]) {
      expect(migration).toContain(`CREATE TABLE public.${table}`);
      expect(migration).toContain(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`);
    }
  });

  test("authenticated clients are read-only and mutation RPCs are service-role only", () => {
    expect(migration).not.toMatch(
      /GRANT\s+(?:INSERT|UPDATE|DELETE|ALL)[\s\S]{0,120}governance_[a-z_]+[\s\S]{0,80}TO authenticated/i,
    );
    expect(hardeningMigration).toContain("FROM PUBLIC, anon, authenticated");
    expect(hardeningMigration).toContain("TO authenticated");
    expect(hardeningMigration).toContain("TO service_role");
    for (const fn of [
      "governance_create_proposal",
      "governance_submit_proposal",
      "governance_add_evidence",
      "governance_add_human_review",
      "governance_record_decision",
      "governance_register_agent",
    ]) {
      expect(migration).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}`));
      expect(migration).toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}`));
    }
  });

  test("participant identity and decision uniqueness are enforced in SQL", () => {
    expect(migration).toContain("kind = 'human' AND user_id IS NOT NULL");
    expect(migration).toContain("kind <> 'human' AND user_id IS NULL");
    expect(migration).toMatch(
      /proposal_id uuid NOT NULL UNIQUE REFERENCES public\.governance_proposals/,
    );
    expect(migration).toContain("proposal_version_conflict");
  });

  test("final decision and agent registration remain admin-gated at the server boundary", () => {
    expect(functions).toMatch(/recordGovernanceDecision[\s\S]*await assertAdmin\(context\)/);
    expect(functions).toMatch(/registerGovernanceAgent[\s\S]*await assertAdmin\(context\)/);
  });

  test("production governance uses provider-neutral RONS auth and keyed sovereign procedures", () => {
    expect(functions).toContain(".middleware([requireRonsAuth])");
    expect(functions).not.toContain("requireSupabaseAuth");
    expect(functions).toContain("callSovereignGovernanceProcedure");
    expect(backendProvider).toContain("export type GovernanceProcedureName");
    expect(backendProvider).toContain("RONS_GATEWAY_PROCEDURE_KEY_FILE");
    expect(backendProvider).toContain("Sovereign procedure gateway must be loopback HTTP");
  });
});
