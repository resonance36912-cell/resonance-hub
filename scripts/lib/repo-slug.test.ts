import { describe, expect, test } from "bun:test";
import {
  parseRepoSlugs,
  validateRepoList,
  validateRepoSlug,
} from "../../src/lib/repo-slug";

describe("validateRepoSlug", () => {
  test("accepts standard owner/repo", () => {
    expect(validateRepoSlug("lovable-dev/hub")).toEqual({
      ok: true,
      repo: "lovable-dev/hub",
    });
  });

  test("accepts dots, underscores, and digits in repo name", () => {
    expect(validateRepoSlug("acme/my_repo.v2-beta")).toEqual({
      ok: true,
      repo: "acme/my_repo.v2-beta",
    });
  });

  test("trims surrounding whitespace", () => {
    expect(validateRepoSlug("  a/b  ")).toEqual({ ok: true, repo: "a/b" });
  });

  test("rejects empty input", () => {
    const r = validateRepoSlug("   ");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/empty/i);
  });

  test("rejects missing slash", () => {
    const r = validateRepoSlug("justowner");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/owner\/repo/);
  });

  test("rejects extra slashes", () => {
    const r = validateRepoSlug("a/b/c");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/owner\/repo/);
  });

  test("rejects owner with leading hyphen", () => {
    const r = validateRepoSlug("-bad/repo");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/Invalid owner/);
  });

  test("rejects owner with trailing hyphen", () => {
    const r = validateRepoSlug("bad-/repo");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/Invalid owner/);
  });

  test("rejects owner with consecutive hyphens", () => {
    const r = validateRepoSlug("a--b/repo");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/Invalid owner/);
  });

  test("rejects owner over 39 chars", () => {
    const r = validateRepoSlug(`${"a".repeat(40)}/repo`);
    expect(r.ok).toBe(false);
  });

  test("rejects repo over 100 chars", () => {
    const r = validateRepoSlug(`owner/${"a".repeat(101)}`);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/Invalid repository/);
  });

  test('rejects repo named "." or ".."', () => {
    expect(validateRepoSlug("owner/.").ok).toBe(false);
    expect(validateRepoSlug("owner/..").ok).toBe(false);
  });

  test("rejects illegal characters in repo", () => {
    const r = validateRepoSlug("owner/bad name");
    expect(r.ok).toBe(false);
  });
});

describe("parseRepoSlugs", () => {
  test("splits on commas, whitespace, and newlines", () => {
    expect(parseRepoSlugs("a/b, c/d\ne/f  g/h")).toEqual([
      "a/b",
      "c/d",
      "e/f",
      "g/h",
    ]);
  });

  test("deduplicates preserving order", () => {
    expect(parseRepoSlugs("a/b, c/d, a/b")).toEqual(["a/b", "c/d"]);
  });

  test("returns empty for empty input", () => {
    expect(parseRepoSlugs("   ")).toEqual([]);
  });
});

describe("validateRepoList", () => {
  test("returns empty list when all slugs valid", () => {
    expect(validateRepoList("a/b, c/d")).toEqual([]);
  });

  test("collects only invalid slugs with error messages", () => {
    const errs = validateRepoList("a/b, bad, c/d/e, owner/.");
    expect(errs.map((e) => e.repo)).toEqual(["bad", "c/d/e", "owner/."]);
    for (const e of errs) expect(e.error).toBeTruthy();
  });
});
