import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..", "..");
const migrationName = readdirSync(join(root, "supabase", "migrations"))
  .filter((name) => name.endsWith("_datanest_collaboration_core.sql"))
  .sort()
  .at(-1);

if (!migrationName) throw new Error("datanest_collaboration_core migration missing");
const sql = readFileSync(join(root, "supabase", "migrations", migrationName), "utf8");

describe("DataNest collaboration schema", () => {
  test("reuses Nova projects and bridge devices instead of creating duplicate authorities", () => {
    expect(sql).toContain("REFERENCES public.nova_projects(id)");
    expect(sql).toContain("REFERENCES public.bridge_devices(id)");
    expect(sql).not.toContain("CREATE TABLE public.datanest_workspaces");
    expect(sql).not.toContain("CREATE TABLE public.datanest_users");
  });

  test("stores only opaque provider references, never credential columns", () => {
    expect(sql).toContain("CREATE TABLE public.datanest_project_integrations");
    expect(sql).toContain("external_ref text NOT NULL");
    expect(sql).not.toMatch(/access_token|refresh_token|password|cookie|secret_key/i);
  });

  test("enables RLS and keeps collaboration tables server-only", () => {
    expect(sql).toContain("ALTER TABLE public.datanest_project_integrations ENABLE ROW LEVEL SECURITY");
    expect(sql).toContain("ALTER TABLE public.datanest_project_devices ENABLE ROW LEVEL SECURITY");
    expect(sql).toMatch(/REVOKE ALL ON TABLE public\.datanest_project_integrations FROM PUBLIC, anon, authenticated/);
    expect(sql).toMatch(/REVOKE ALL ON TABLE public\.datanest_project_devices FROM PUBLIC, anon, authenticated/);
    expect(sql).not.toMatch(/GRANT SELECT ON TABLE public\.datanest_project_(integrations|devices) TO authenticated/);
  });
});
