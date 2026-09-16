import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "../..");
const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as {
  scripts?: Record<string, string>;
};
const config = readFileSync(resolve(root, "vite.local.config.ts"), "utf8");

describe("sovereign local production build", () => {
  test("exposes explicit local build and start commands", () => {
    expect(pkg.scripts?.["build:local"]).toBe("vite --config vite.local.config.ts build");
    expect(pkg.scripts?.["start:local"]).toBe("node .output-local/server/index.mjs");
  });

  test("builds a Node server into .output-local", () => {
    expect(config).toContain('preset: "node-server"');
    expect(config).toContain('dir: ".output-local"');
  });

  test("forces sovereign client auth in the local bundle", () => {
    expect(config).toContain('VITE_RONS_AUTH_MODE": JSON.stringify("sovereign")');
    expect(config).toContain('VITE_RONS_AUTH_SHADOW": JSON.stringify("0")');
  });
});
