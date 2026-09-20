import { resolve, win32 } from "node:path";

export type LiveListener = {
  port: number;
  pid: number;
  commandLine: string;
};

function normalized(value: string): string {
  return value.replaceAll("/", "\\").replaceAll("\\\\", "\\").toLowerCase();
}

export function buildServerEntry(root: string, outputDir: string): string {
  const windowsRoot = /^[a-zA-Z]:[\\/]/.test(root) || root.startsWith("\\\\");
  const resolver = windowsRoot ? win32.resolve : resolve;
  return resolver(root, outputDir, "server", "index.mjs");
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
