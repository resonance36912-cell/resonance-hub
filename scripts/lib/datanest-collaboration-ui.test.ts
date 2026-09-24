import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..", "..");
const layoutPath = join(root, "src/routes/datanest.tsx");
const indexPath = join(root, "src/routes/datanest.index.tsx");
const projectPath = join(root, "src/routes/datanest.projects.$projectId.tsx");
const shellPath = join(root, "src/components/datanest/DataNestShell.tsx");

const read = (path: string) => (existsSync(path) ? readFileSync(path, "utf8") : "");
const layout = read(layoutPath);
const index = read(indexPath);
const project = read(projectPath);
const shell = read(shellPath);

describe("DataNest collaboration UI", () => {
  test("defines all collaboration routes and shell", () => {
    expect(existsSync(layoutPath)).toBe(true);
    expect(existsSync(indexPath)).toBe(true);
    expect(existsSync(projectPath)).toBe(true);
    expect(existsSync(shellPath)).toBe(true);
  });

  test("is authenticated and separate from MYIFY", () => {
    expect(layout).toContain('createFileRoute("/datanest")');
    expect(layout).toContain("ronsAuth.getUser()");
    expect(layout).toContain('to: "/login"');
    expect(layout).toContain('next: "/datanest"');
    expect(index.toLowerCase()).not.toContain("myify");
  });

  test("uses Nova projects as the collaboration workspace authority", () => {
    expect(index).toContain("listNovaProjects");
    expect(index).toContain("createNovaProject");
    expect(project).toContain("getDataNestCollaborationProject");
    expect(project).toContain('/nova/projects/$projectId');
  });

  test("states the current free no-billing mode", () => {
    expect(index).toMatch(/free/i);
    expect(index).toMatch(/no.billing|no billing/i);
  });

  test("never asks users to paste provider credentials", () => {
    const all = layout + index + project + shell;
    expect(all).not.toMatch(/access token|refresh token|api key|password|cookie/i);
    expect(all).toContain("Connect through an authorized provider");
  });
});
