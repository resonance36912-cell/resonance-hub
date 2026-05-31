#!/usr/bin/env bun
/**
 * install-discernment-lint.ts
 *
 * One-shot bootstrap a spoke repo (ePublisher, Creative Studio, Sync Vision,
 * YouTube Optimizer) to enforce the Discernment contract end-to-end.
 *
 * Run inside the spoke repo root:
 *
 *   bun run /path/to/resonance-hub/scripts/install-discernment-lint.ts \
 *     --hub /path/to/resonance-hub
 *
 * Or with a remote Hub checkout already on disk via the HUB_DIR env var:
 *
 *   HUB_DIR=../resonance-hub bun run scripts/install-discernment-lint.ts
 *
 * What it does (idempotent):
 *
 *  1. Copies the three canonical contract files from the Hub into the spoke,
 *     overwriting any drift:
 *       - src/lib/discernment.ts
 *       - src/lib/discernment-guard.ts
 *       - scripts/verify-discernment-usage.ts
 *  2. Adds `verify:discernment-usage` to package.json scripts.
 *  3. Appends `bun run scripts/verify-discernment-usage.ts` to the spoke's
 *     `prebuild` script if not already wired.
 *  4. Writes `.github/workflows/discernment-lint.yml` that calls the Hub's
 *     reusable workflow on every PR.
 *
 * After running, commit the changes and open a PR — CI will fail any future
 * generation route that bypasses the guard or provenance label.
 */

import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  copyFileSync,
} from "node:fs";
import { join, dirname, resolve } from "node:path";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const HUB_DIR = resolve(arg("hub") ?? process.env.HUB_DIR ?? "../resonance-hub");
const SPOKE_DIR = resolve(process.cwd());

if (!existsSync(join(HUB_DIR, "src/lib/discernment.ts"))) {
  console.error(
    `❌ Hub directory not found or missing contract files: ${HUB_DIR}\n` +
      `   Pass --hub <path> or set HUB_DIR=<path>.`,
  );
  process.exit(1);
}

if (SPOKE_DIR === HUB_DIR) {
  console.error("❌ Refusing to install: spoke dir equals hub dir.");
  process.exit(1);
}

const CONTRACT_FILES = [
  "src/lib/discernment.ts",
  "src/lib/discernment-guard.ts",
  "scripts/verify-discernment-usage.ts",
  "scripts/report-discernment-usage.ts",
];

function ensureDir(p: string) {
  mkdirSync(dirname(p), { recursive: true });
}

console.log(`Hub : ${HUB_DIR}`);
console.log(`Spoke: ${SPOKE_DIR}\n`);

// 1) Copy contract files (overwrite drift)
for (const rel of CONTRACT_FILES) {
  const src = join(HUB_DIR, rel);
  const dst = join(SPOKE_DIR, rel);
  ensureDir(dst);
  copyFileSync(src, dst);
  console.log(`✓ synced ${rel}`);
}

// 2 + 3) Update package.json
const pkgPath = join(SPOKE_DIR, "package.json");
if (!existsSync(pkgPath)) {
  console.error("❌ No package.json in spoke dir.");
  process.exit(1);
}
const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
pkg.scripts ??= {};

const VERIFY_CMD = "bun run scripts/verify-discernment-usage.ts";
if (pkg.scripts["verify:discernment-usage"] !== VERIFY_CMD) {
  pkg.scripts["verify:discernment-usage"] = VERIFY_CMD;
  console.log("✓ added scripts.verify:discernment-usage");
}

const REPORT_CMD = "bun run scripts/report-discernment-usage.ts";
if (pkg.scripts["report:discernment-usage"] !== REPORT_CMD) {
  pkg.scripts["report:discernment-usage"] = REPORT_CMD;
  console.log("✓ added scripts.report:discernment-usage");
}

const prebuild: string = pkg.scripts.prebuild ?? "";
if (!prebuild.includes("verify-discernment-usage.ts")) {
  pkg.scripts.prebuild = prebuild
    ? `${prebuild} && ${VERIFY_CMD}`
    : VERIFY_CMD;
  console.log("✓ wired verify-discernment-usage into scripts.prebuild");
}

writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");

// 4) GitHub workflow that calls the Hub's reusable workflow
const workflowPath = join(
  SPOKE_DIR,
  ".github/workflows/discernment-lint.yml",
);
ensureDir(workflowPath);
const workflow = `name: Discernment Lint

on:
  pull_request:
    paths:
      - 'src/**/*generate*.functions.ts'
      - 'src/**/*generate*.server.ts'
      - 'src/routes/api/**/*generate*.ts'
      - 'scripts/verify-discernment-usage.ts'
      - 'src/lib/discernment*.ts'
      - 'package.json'
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  pull-requests: write
  checks: write

jobs:
  discernment:
    permissions:
      contents: read
      pull-requests: write
      checks: write
    uses: resonance-org/resonance-hub/.github/workflows/discernment-lint.yml@main
`;
writeFileSync(workflowPath, workflow);
console.log("✓ wrote .github/workflows/discernment-lint.yml");

console.log(
  "\n✅ Discernment lint installed. Commit the changes and open a PR.",
);
