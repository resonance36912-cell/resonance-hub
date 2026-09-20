import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");

describe("Nova Studio accessibility contract", () => {
  test("composer is labelled, keyboard focusable and status-aware", () => {
    const source = read("src/components/nova/NovaComposer.tsx");
    expect(source).toContain('aria-label="Ask Nova"');
    expect(source).toContain("<Textarea");
    expect(source).toContain("focus-visible:");
    expect(source).toContain('type="submit"');
  });

  test("starter actions and shell controls are native keyboard controls", () => {
    const canvas = read("src/components/nova/NovaCanvas.tsx");
    const shell = read("src/components/nova/NovaShell.tsx");
    expect(canvas).toContain("<button");
    expect(canvas).toContain("focus-visible:");
    expect(shell).toContain('aria-label="Open Nova navigation"');
    expect(shell).toContain('aria-label="Open Nova intelligence"');
  });

  test("job progress and governance communicate state in text as well as styling", () => {
    const jobs = read("src/components/nova/NovaJobProgress.tsx");
    const rsgp = read("src/components/nova/RsgpStatus.tsx");
    expect(jobs).toContain('aria-live="polite"');
    expect(jobs).toContain("status");
    expect(rsgp).toContain("RSGP");
    expect(rsgp).toContain("Governed");
    expect(rsgp).toContain("sr-only");
  });

  test("decision tray exposes clear human-gate language", () => {
    const source = read("src/components/nova/NovaDecisionTray.tsx");
    expect(source).toContain("Decision Tray");
    expect(source).toContain("needs your input");
  });
});
