/**
 * Ensures every `ROUTES` constant and `LINKS` preset in `src/lib/routes.ts`
 * corresponds byte-for-byte to a real `to` navigation path registered in
 * `src/routeTree.gen.ts`.
 *
 * This closes the gap between route `fullPath` values like "/admin/" and
 * canonical navigation `to` values like "/admin". A stale ROUTES entry —
 * the "/admin/" regression — fails here immediately.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { LINKS, ROUTES } from "../../src/lib/routes";

const ROUTE_TREE = join(process.cwd(), "src/routeTree.gen.ts");

function loadRegistry(): { fullPaths: Set<string>; toPaths: Set<string> } {
  const src = readFileSync(ROUTE_TREE, "utf8");
  const fullPaths = new Set<string>();
  for (const m of src.matchAll(/fullPath:\s*'(\/[^']*)'/g)) fullPaths.add(m[1]);
  const toPaths = new Set<string>();
  const byToBlock = src.match(/export interface FileRoutesByTo \{([\s\S]*?)\n\}/)?.[1] ?? "";
  for (const m of byToBlock.matchAll(/^\s*'(\/[^']*)':\s*typeof\s+\w+/gm)) {
    toPaths.add(m[1]);
  }
  return { fullPaths, toPaths };
}

const { fullPaths, toPaths } = loadRegistry();

describe("ROUTES ↔ router registry parity", () => {
  it("registry loaded at least one path", () => {
    expect(fullPaths.size).toBeGreaterThan(0);
    expect(toPaths.size).toBeGreaterThan(0);
  });

  it("every ROUTES value matches a registered `to` path exactly", () => {
    const mismatches: Array<{ name: string; value: string; hint: string }> = [];
    for (const [name, value] of Object.entries(ROUTES)) {
      if (toPaths.has(value)) continue;
      // Suggest the closest known form to make failures actionable.
      const suggestion =
        [...toPaths].find((p) => p.replace(/\/$/, "") === value.replace(/\/$/, "")) ??
        [...fullPaths].find((p) => p.replace(/\/$/, "") === value.replace(/\/$/, "")) ??
        "(no close match)";
      mismatches.push({ name, value, hint: suggestion });
    }
    if (mismatches.length > 0) {
      const detail = mismatches
        .map((m) => `  ROUTES.${m.name} = "${m.value}"  →  did you mean "${m.hint}"?`)
        .join("\n");
      throw new Error(
        `ROUTES entries not registered in FileRoutesByTo:\n${detail}`,
      );
    }
  });

  it("no ROUTES value has a trailing slash (except root)", () => {
    const offenders = Object.entries(ROUTES).filter(
      ([, v]) => v !== "/" && v.endsWith("/"),
    );
    expect(offenders).toEqual([]);
  });

  it("ROUTES values are unique (no duplicated destinations)", () => {
    const seen = new Map<string, string>();
    const dupes: string[] = [];
    for (const [name, value] of Object.entries(ROUTES)) {
      const prior = seen.get(value);
      if (prior) dupes.push(`${prior} and ${name} both point to ${value}`);
      else seen.set(value, name);
    }
    expect(dupes).toEqual([]);
  });
});

describe("LINKS ↔ router registry parity", () => {
  it("every LINKS preset targets a registered `to` path", () => {
    const mismatches: Array<{ name: string; to: unknown }> = [];
    for (const [name, preset] of Object.entries(LINKS)) {
      const to = (preset as { to?: unknown }).to;
      if (typeof to !== "string") {
        mismatches.push({ name, to });
        continue;
      }
      if (!toPaths.has(to)) {
        mismatches.push({ name, to });
      }
    }
    if (mismatches.length > 0) {
      const detail = mismatches
        .map((m) => `  LINKS.${m.name}.to = ${JSON.stringify(m.to)}`)
        .join("\n");
      throw new Error(
        `LINKS presets not registered in FileRoutesByTo:\n${detail}`,
      );
    }
  });

  it("no LINKS.to has a trailing slash (except root)", () => {
    const offenders = Object.entries(LINKS).filter(([, p]) => {
      const to = (p as { to?: unknown }).to;
      return typeof to === "string" && to !== "/" && to.endsWith("/");
    });
    expect(offenders).toEqual([]);
  });
});
