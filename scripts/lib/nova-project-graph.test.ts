import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const contracts = await import("../../src/lib/nova/contracts").catch(() => null);
const projects = await import("../../src/lib/nova/projects").catch(() => null);
const artifacts = await import("../../src/lib/nova/artifacts").catch(() => null);
const migrationPath = "supabase/migrations/20260919220000_nova_project_graph.sql";
const migration = await Bun.file(migrationPath).text();

describe("Nova Project Graph contracts", () => {
  test("bounds project names and modes", () => {
    expect(contracts).not.toBeNull();
    if (!contracts) return;
    expect(contracts.ProjectCreateInput.parse({ name: "Lab Inventory", mode: "builder" }).mode).toBe("builder");
    expect(() => contracts.ProjectCreateInput.parse({ name: "x", mode: "builder" })).toThrow();
    expect(() => contracts.ProjectCreateInput.parse({ name: "Lab Inventory", mode: "root" })).toThrow();
    expect(() => contracts.ProjectCreateInput.parse({ name: "Lab", mode: "builder", unexpected: true })).toThrow();
  });

  test("keeps the approved collaboration roles explicit", () => {
    expect(contracts).not.toBeNull();
    if (!contracts) return;
    for (const role of ["owner", "collaborator", "reviewer", "observer"]) {
      expect(contracts.ProjectRole.parse(role)).toBe(role);
    }
    expect(() => contracts.ProjectRole.parse("admin")).toThrow();
  });

  test("accepts only governed artifact relation kinds", () => {
    expect(contracts).not.toBeNull();
    if (!contracts) return;
    for (const kind of [
      "generated_from", "derived_from", "references", "belongs_to", "implements",
      "tests", "deploys", "supersedes", "approved_by", "contradicts",
    ]) {
      expect(contracts.ArtifactRelationKind.parse(kind)).toBe(kind);
    }
    expect(() => contracts.ArtifactRelationKind.parse("owns_everything")).toThrow();
  });
});

describe("Nova artifact versioning", () => {
  const versions = [
    { id: "v1", version_number: 1, state: "draft" as const, content_hash: "a", derived_from_version_id: null },
    { id: "v2", version_number: 2, state: "draft" as const, content_hash: "b", derived_from_version_id: "v1" },
  ];

  test("approval preserves every historical version", () => {
    expect(artifacts).not.toBeNull();
    if (!artifacts) return;
    const next = artifacts.approveArtifactVersionState(versions, "v2");
    expect(next).toHaveLength(2);
    expect(next.map((v: { id: string }) => v.id)).toEqual(["v1", "v2"]);
    expect(next.find((v: { id: string }) => v.id === "v2")?.state).toBe("approved");
    expect(versions[1].state).toBe("draft");
  });

  test("restore appends a new derived version instead of rewriting history", () => {
    expect(artifacts).not.toBeNull();
    if (!artifacts) return;
    const next = artifacts.restoreArtifactVersionState(versions, "v1", "v3");
    expect(next).toHaveLength(3);
    expect(next.slice(0, 2)).toEqual(versions);
    expect(next[2]).toMatchObject({
      id: "v3",
      version_number: 3,
      state: "draft",
      content_hash: "a",
      derived_from_version_id: "v1",
    });
  });
});

describe("Nova Project Graph database boundary", () => {
  test("creates all graph tables with RLS and keeps direct writes server-only", () => {
    for (const table of [
      "nova_projects", "nova_project_members", "nova_artifacts", "nova_artifact_versions", "nova_artifact_relations",
    ]) {
      expect(migration).toContain(`CREATE TABLE public.${table}`);
      expect(migration).toContain(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`);
    }
    expect(migration).toContain("FROM PUBLIC, anon, authenticated");
    expect(migration).toContain("TO service_role");
  });

  test("enforces membership, version identity and typed relations", () => {
    expect(migration).toContain("UNIQUE (project_id, user_id)");
    expect(migration).toContain("UNIQUE (artifact_id, version_number)");
    expect(migration).toContain("derived_from_version_id");
    expect(migration).toContain("relation_kind");
    expect(migration).toContain("owner_user_id = auth.uid()");
  });

  test("server functions use RONS auth and backend-role boundary", () => {
    const source = readFileSync("src/lib/nova/functions.ts", "utf8");
    expect(source).toContain("requireRonsAuth");
    expect(source).toContain("hasServerBackendRole");
    expect(source).not.toContain("requireSupabaseAuth");
    for (const fn of ["createNovaProject", "getNovaProject", "listNovaProjects", "createNovaArtifactVersion", "approveNovaArtifactVersion", "restoreNovaArtifactVersion"]) {
      expect(source).toContain(`export const ${fn}`);
    }
  });
});
