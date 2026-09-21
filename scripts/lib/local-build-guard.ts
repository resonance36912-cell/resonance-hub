import { resolve, win32 } from "node:path";

export type LiveListener = {
  port: number;
  pid: number;
  commandLine: string;
};

function normalized(value: string): string {
  return value.replaceAll("/", "\\").replaceAll("\\\\", "\\").toLowerCase();
}

function isWindowsAbsolutePath(value: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(value) || value.startsWith("\\\\");
}

export function buildServerEntry(root: string, outputDir: string): string {
  const pathApi = isWindowsAbsolutePath(root) ? win32 : { resolve };
  return pathApi.resolve(root, outputDir, "server", "index.mjs");
}

function servesExactTargetBundle(commandLine: string, targetEntry: string): boolean {
  const command = normalized(commandLine);
  const index = command.indexOf(targetEntry);
  if (index < 0) return false;

  const end = index + targetEntry.length;
  const beforeOk = index === 0 || /[\\s"' ]/.test(command[index - 1]);
  const afterOk = end === command.length || /[\\s"' ]/.test(command[end]);
  return beforeOk && afterOk;
}

export function findLiveBuildHazards(
  root: string,
  outputDir: string,
  listeners: LiveListener[],
): LiveListener[] {
  const targetEntry = normalized(buildServerEntry(root, outputDir));
  return listeners.filter((listener) => servesExactTargetBundle(listener.commandLine, targetEntry));
}

export function isCandidateOutput(outputDir: string): boolean {
  const normalizedOutput = normalized(outputDir);
  return !normalizedOutput.endsWith("\\.output-local") && normalizedOutput !== ".output-local";
}
