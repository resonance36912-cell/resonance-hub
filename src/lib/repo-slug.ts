// Shared GitHub owner/repo slug validation. Used by both server functions
// and client-side UI for consistent, immediate feedback.

// GitHub owner/repo rules (simplified but strict):
//  - Owner: 1–39 chars; alphanumerics and single hyphens; no leading/trailing hyphen.
//  - Repo:  1–100 chars; alphanumerics, dot, hyphen, underscore; not "." or "..".
const OWNER_RE = /^[a-zA-Z0-9](?:[a-zA-Z0-9]|-(?=[a-zA-Z0-9])){0,38}$/;
const REPO_RE = /^[a-zA-Z0-9._-]{1,100}$/;

export interface ValidRepoSlug {
  ok: true;
  repo: string;
}

export interface InvalidRepoSlug {
  ok: false;
  error: string;
}

export type RepoSlugResult = ValidRepoSlug | InvalidRepoSlug;

export function validateRepoSlug(slug: string): RepoSlugResult {
  const trimmed = slug.trim();
  if (!trimmed) return { ok: false, error: "Empty repository name" };
  const parts = trimmed.split("/");
  if (parts.length !== 2) {
    return { ok: false, error: `"${trimmed}" is not in owner/repo format` };
  }
  const [owner, repo] = parts;
  if (!OWNER_RE.test(owner)) {
    return {
      ok: false,
      error: `Invalid owner "${owner}" — use 1–39 letters, digits or single hyphens`,
    };
  }
  if (!REPO_RE.test(repo) || repo === "." || repo === "..") {
    return {
      ok: false,
      error: `Invalid repository "${repo}" — use letters, digits, dot, hyphen or underscore (max 100 chars)`,
    };
  }
  return { ok: true, repo: `${owner}/${repo}` };
}

export function parseRepoSlugs(input: string): string[] {
  return Array.from(
    new Set(
      input
        .split(/[\s,]+/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0),
    ),
  );
}

export function validateRepoList(input: string): { repo: string; error: string }[] {
  const raw = parseRepoSlugs(input);
  const errors: { repo: string; error: string }[] = [];
  for (const slug of raw) {
    const result = validateRepoSlug(slug);
    if (!result.ok) {
      errors.push({ repo: slug, error: result.error });
    }
  }
  return errors;
}
