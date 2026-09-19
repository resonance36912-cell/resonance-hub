import { describe, expect, test } from "bun:test";
import { buildServerEntry, findLiveBuildHazards, isCandidateOutput } from "./local-build-guard";

describe("local Hub build guard", () => {
  test("identifies the server entry for a selected output directory", () => {
    expect(buildServerEntry("C:\\Resonance\\Hub", ".output-local")).toContain(".output-local");
    expect(buildServerEntry("C:\\Resonance\\Hub", ".output-local")).toEndWith("server\\index.mjs");
  });

  test("blocks only when a listener serves the exact target bundle", () => {
    const root = "C:\\Resonance\\Sources\\ronsas-hub-canonical";
    const listeners = [
      {
        port: 4174,
        pid: 123,
        commandLine:
          '"C:\\Program Files\\nodejs\\node.exe" C:\\Resonance\\Sources\\ronsas-hub-canonical\\.output-local\\server\\index.mjs',
      },
      {
        port: 4173,
        pid: 456,
        commandLine:
          '"C:\\Program Files\\nodejs\\node.exe" C:\\Other\\Hub\\.output-local\\server\\index.mjs',
      },
    ];

    expect(findLiveBuildHazards(root, ".output-local", listeners)).toEqual([listeners[0]]);
    expect(findLiveBuildHazards(root, ".output-candidate-local", listeners)).toEqual([]);
  });

  test("recognizes isolated candidate outputs", () => {
    expect(isCandidateOutput(".output-candidate-local")).toBe(true);
    expect(isCandidateOutput("C:\\tmp\\hub-build")).toBe(true);
    expect(isCandidateOutput(".output-local")).toBe(false);
    expect(isCandidateOutput("C:\\Resonance\\Hub\\.output-local")).toBe(false);
  });
});
