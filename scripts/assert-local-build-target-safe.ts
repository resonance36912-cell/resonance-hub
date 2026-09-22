#!/usr/bin/env bun
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import {
  findLiveBuildHazards,
  isCandidateOutput,
  type LiveListener,
} from "./lib/local-build-guard";

const root = process.cwd();
const outputDir = process.env.RONS_LOCAL_OUTPUT_DIR?.trim() || ".output-local";
const target = resolve(root, outputDir);

function windowsListeners(): LiveListener[] {
  const script = [
    "$rows=@();",
    "foreach($port in @(4173,4174)){",
    "  $listener=Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1;",
    "  if($listener){",
    "    $proc=Get-CimInstance Win32_Process -Filter ('ProcessId='+$listener.OwningProcess) -ErrorAction SilentlyContinue;",
    "    $rows += [pscustomobject]@{port=$port;pid=[int]$listener.OwningProcess;commandLine=[string]$proc.CommandLine};",
    "  }",
    "}",
    "$rows | ConvertTo-Json -Compress",
  ].join(" ");

  const stdout = execFileSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", script],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  ).trim();

  if (!stdout) return [];
  const parsed = JSON.parse(stdout) as LiveListener | LiveListener[];
  return Array.isArray(parsed) ? parsed : [parsed];
}

function detectListeners(): LiveListener[] {
  if (process.platform !== "win32") return [];
  try {
    return windowsListeners();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Unable to inspect live Hub listeners before local build: ${detail}. Build a candidate explicitly with RONS_LOCAL_OUTPUT_DIR=.output-candidate-local.`,
    );
  }
}

if (isCandidateOutput(outputDir)) {
  console.log(`✓ local build target is isolated candidate output: ${target}`);
  process.exit(0);
}

const listeners = detectListeners();
const hazards = findLiveBuildHazards(root, outputDir, listeners);

if (hazards.length > 0) {
  const owners = hazards.map((item) => `port ${item.port} (PID ${item.pid})`).join(", ");
  console.error(
    [
      `Refusing to overwrite live Hub build: ${target}`,
      `The same server bundle is currently owned by ${owners}.`,
      "Use RONS_LOCAL_OUTPUT_DIR=.output-candidate-local bun run build:local, then promote with ops/ealiophin/cluster/PROMOTE-RONSAS-HUB.ps1.",
    ].join("\n"),
  );
  process.exit(1);
}

console.log(`✓ local build target is not owned by a live 4173/4174 listener: ${target}`);
