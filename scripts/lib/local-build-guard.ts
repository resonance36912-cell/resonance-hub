import { resolve } from "node:path";

export type LiveListener = {
  port: number;
  pid: number;
  commandLine: string;
};

function normalized(value: string): string {
  return value.replaceAll("/", "\\").replaceAll("\\\\", "\\").toLowerCase();
}

export function buildServerEntry(root: string, outputDir: string): string {
  return resolve(root, outputDir, "server", "index.mjs");
}

export function findLiveBuildHazards(
  root: string,
  outputDir: string,
  listeners: LiveListener[],
): LiveListener[] {
  const targetEntry = normalized(buildServerEntry(root, outputDir));
  return listeners.filter((listener) => normalized(listener.commandLine).includes(targetEntry));
}

export function isCandidateOutput(outputDir: string): boolean {
  const normalizedOutput = normalized(outputDir);
  return !normalizedOutput.endsWith("\\.output-local") && normalizedOutput !== ".output-local";
}
