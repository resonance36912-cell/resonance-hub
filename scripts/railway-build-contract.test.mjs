import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = new URL("../", import.meta.url);
const source = readFileSync(new URL("vite.railway.config.ts", root), "utf8");
const pkg = JSON.parse(readFileSync(new URL("package.json", root), "utf8"));

function inspectConfig(env = {}) {
  const expectedImports = [
    'import { defineConfig } from "vite";',
    'import { tanstackStart } from "@tanstack/react-start/plugin/vite";',
    'import { nitro } from "nitro/vite";',
    'import react from "@vitejs/plugin-react";',
    'import tailwindcss from "@tailwindcss/vite";',
    'import tsconfigPaths from "vite-tsconfig-paths";',
  ];
  let executable = source;
  for (const statement of expectedImports) {
    assert.ok(executable.includes(statement), `Expected import: ${statement}`);
    executable = executable.replace(statement, "");
  }
  assert.doesNotMatch(executable, /^\s*import\s/m, "Unexpected import needs a reviewed test stub");
  assert.equal((executable.match(/export default defineConfig\(/g) || []).length, 1);
  executable = executable.replace("export default defineConfig(", "globalThis.config = defineConfig(");
  const plugin = (name) => (options = {}) => ({ name, options });
  const context = {
    process: { cwd: () => fileURLToPath(root).replace(/[\\/]$/, ""), env },
    defineConfig: (config) => config,
    tailwindcss: plugin("tailwindcss"),
    tsconfigPaths: plugin("tsconfigPaths"),
    tanstackStart: plugin("tanstackStart"),
    nitro: plugin("nitro"),
    react: plugin("react"),
  };
  vm.runInNewContext(executable, context, { timeout: 1000, filename: "vite.railway.config.ts" });
  return context.config;
}

const plain = (value) => JSON.parse(JSON.stringify(value));
const options = (config, name) => config.plugins.find((plugin) => plugin.name === name)?.options;

test("cloud auth-shadow definition is off even with inherited local flags", () => {
  const config = inspectConfig({ VITE_RONS_AUTH_SHADOW: "1" });
  assert.equal(JSON.parse(config.define["import.meta.env.VITE_RONS_AUTH_SHADOW"]), "0");
});

test("Railway Node output is isolated", () => {
  const config = inspectConfig({ RONS_LOCAL_OUTPUT_DIR: ".output-local" });
  assert.deepEqual(plain(options(config, "nitro")), {
    preset: "node-server",
    output: { dir: ".output-railway" },
  });
});

test("server-only import protection remains an error", () => {
  const start = options(inspectConfig(), "tanstackStart");
  assert.equal(start.server.entry, "server");
  assert.deepEqual(plain(start.importProtection), {
    behavior: "error",
    client: { files: ["**/server/**"], specifiers: ["server-only"] },
  });
});

test("the Railway target contains only the intended five plugins", () => {
  const config = inspectConfig();
  assert.deepEqual(plain(config.plugins.map((plugin) => plugin.name)), [
    "tailwindcss", "tsconfigPaths", "tanstackStart", "nitro", "react",
  ]);
});

test("Supabase vendor chunk handles POSIX and Windows paths", () => {
  const chunks = inspectConfig().build.rollupOptions.output.manualChunks;
  assert.equal(chunks("/project/node_modules/@supabase/supabase-js/index.js"), "vendor-supabase");
  assert.equal(chunks("C:\\project\\node_modules\\@supabase\\supabase-js\\index.js"), "vendor-supabase");
  assert.equal(chunks("/project/src/routes/index.tsx"), undefined);
});

test("Railway build runs contract tests and the existing commercial-mode prebuild", () => {
  assert.equal(
    pkg.scripts["build:railway"],
    "node --test scripts/railway-build-contract.test.mjs && bun run prebuild && vite --config vite.railway.config.ts build",
  );
  assert.equal(pkg.scripts.prebuild, "bun run scripts/verify-commercial-mode.ts");
});

test("Railway start command points to the isolated server bundle", () => {
  const output = options(inspectConfig(), "nitro").output.dir;
  assert.equal(pkg.scripts["start:railway"], `node ${output}/server/index.mjs`);
});

test("the existing local and Cloudflare commands remain unchanged", () => {
  assert.equal(pkg.scripts["start:local"], "node .output-local/server/index.mjs");
  assert.equal(pkg.scripts.build, "vite build");
  assert.equal(pkg.scripts.preview, "vite preview");
});

test("the Railway bundle is ignored by Git", () => {
  const ignore = readFileSync(new URL(".gitignore", root), "utf8");
  assert.ok(ignore.split(/\r?\n/).includes(".output-railway/"));
});
