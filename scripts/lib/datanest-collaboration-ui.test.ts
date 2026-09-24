import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..", "..");
const layout = readFileSync(join(root, "src/routes/datanest.tsx"), "utf8");
const index = readFileSync(join(root, "src/routes/datanest.index.tsx"), "utf8");
const project = readFileSync(join(root, "src/routes/datanest.projects.$projectId.tsx"), "utf8");
const shell = readFileSync(join(root, "src/components/datanest/DataNestShell.tsx"), "utf8");

describe("DataNest collaboration UI", () => {
  test("is authenticated and separate from MYIFY", () => {
    expect(layout).toContain('createFileRoute("/datanest")');
    expect(layout).toContain("ronsAuth.getUser()");
    expect(layout).toContain('to: "/login"');
    expect(layout).toContain('next: "/datanest"');
    expect(index.toLowerCase()).not.toContain("myify");
  });

  test("uses Nova projects as the workspace authority", () => {
    expect(index).toContain("listNovaProjects");
    expect(index).toContain("createNovaProject");
    expect(project).toContain("getDataNestCollaborationProject");
    expect(project).toContain('/nova/projects/$projectId');
  });

  test("keeps connection setup reference-only and current promotion free", () => {
    const all = layout + index + project + shell;
    expect(all).not.toMatch(/access token|refresh token|api key|cookie/i);
    expect(all).toContain("Connect through an authorized provider");
    expect(all).toContain("Free · no billing");
  });
});
