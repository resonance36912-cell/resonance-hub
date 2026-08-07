#!/usr/bin/env bun
/**
 * CLI wrapper around scripts/lib/manifest-guard.ts
 *
 * Usage:
 *   bun run scripts/manifest-guard.ts snapshot [--label prebuild]
 *   bun run scripts/manifest-guard.ts verify
 *   bun run scripts/manifest-guard.ts run -- <command...>
 *
 * `run` snapshots the manifests, executes the command, then fails if
 * package.json or bun.lock changed while the command ran.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import {
  GUARDED_MANIFESTS,
  buildSnapshot,
  diffSnapshots,
  formatChangeReport,
  type ManifestSnapshot,
} from "./lib/manifest-guard";

const ROOT = process.cwd();
const SNAPSHOT_PATH = resolve(ROOT, "node_modules/.cache/manifest-guard.json");

function readManifests(): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const file of GUARDED_MANIFESTS) {
    const p = resolve(ROOT, file);
    out[file] = existsSync(p) ? readFileSync(p, "utf8") : null;
  }
  return out;
}

function writeSnapshot(snap: ManifestSnapshot) {
  mkdirSync(dirname(SNAPSHOT_PATH), { recursive: true });
  writeFileSync(SNAPSHOT_PATH, JSON.stringify(snap, null, 2));
}

function loadSnapshot(): ManifestSnapshot | null {
  if (!existsSync(SNAPSHOT_PATH)) return null;
  try {
    return JSON.parse(readFileSync(SNAPSHOT_PATH, "utf8")) as ManifestSnapshot;
  } catch {
    return null;
  }
}

function verify(before: ManifestSnapshot): number {
  const after = buildSnapshot(readManifests());
  const changes = diffSnapshots(before, after);
  console.log(formatChangeReport(changes));
  return changes.length === 0 ? 0 : 1;
}

const argv = process.argv.slice(2);
const mode = argv[0] ?? "verify";

if (mode === "snapshot") {
  const labelIdx = argv.indexOf("--label");
  const label = labelIdx >= 0 ? argv[labelIdx + 1] : undefined;
  writeSnapshot(buildSnapshot(readManifests(), label));
  console.log(`Manifest snapshot written${label ? ` (${label})` : ""}.`);
  process.exit(0);
}

if (mode === "verify") {
  const before = loadSnapshot();
  if (!before) {
    console.error(
      "No manifest snapshot found. Run `bun run scripts/manifest-guard.ts snapshot` first.",
    );
    process.exit(1);
  }
  process.exit(verify(before));
}

if (mode === "run") {
  const sep = argv.indexOf("--");
  const cmd = (sep >= 0 ? argv.slice(sep + 1) : argv.slice(1)).filter(Boolean);
  if (cmd.length === 0) {
    console.error("Usage: manifest-guard.ts run -- <command...>");
    process.exit(1);
  }
  const before = buildSnapshot(readManifests(), cmd.join(" "));
  const res = spawnSync(cmd[0]!, cmd.slice(1), { stdio: "inherit" });
  const guardCode = verify(before);
  process.exit(res.status !== 0 ? (res.status ?? 1) : guardCode);
}

console.error(`Unknown mode: ${mode}. Use snapshot | verify | run.`);
process.exit(1);
