export type GitHubTransportMode = "direct" | "lovable";

const DIRECT_BASE_URL = "https://api.github.com";
const LOVABLE_BASE_URL = "https://connector-gateway.lovable.dev/github";

export class GitHubApiError extends Error {
  status: number;
  body: string;

  constructor(status: number, body: string) {
    super(`GitHub ${status}: ${body.slice(0, 200)}`);
    this.name = "GitHubApiError";
    this.status = status;
    this.body = body;
  }
}

export class GitHubTransportConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GitHubTransportConfigError";
  }
}

function value(env: NodeJS.ProcessEnv, key: string): string | null {
  const raw = env[key]?.trim();
  return raw ? raw : null;
}
function directToken(env: NodeJS.ProcessEnv): string | null {
  return (
    value(env, "RONS_GITHUB_TOKEN") ??
    value(env, "GITHUB_TOKEN") ??
    value(env, "GH_TOKEN")
  );
}

export function resolveGitHubTransportMode(
  env: NodeJS.ProcessEnv = process.env,
): GitHubTransportMode {
  const requested = value(env, "RONS_GITHUB_TRANSPORT")?.toLowerCase();
  if (requested && requested !== "direct" && requested !== "lovable") {
    throw new GitHubTransportConfigError(
      'RONS_GITHUB_TRANSPORT must be "direct" or "lovable".',
    );
  }
  if (requested === "direct" || requested === "lovable") return requested;

  if (directToken(env)) return "direct";
  if (value(env, "LOVABLE_API_KEY") && value(env, "GITHUB_API_KEY")) {
    return "lovable";
  }
  return "direct";
}

type GitHubTransportConfig = {
  mode: GitHubTransportMode;
  baseUrl: string;
  headers: HeadersInit;
};
function resolveGitHubTransportConfig(
  env: NodeJS.ProcessEnv = process.env,
): GitHubTransportConfig {
  const mode = resolveGitHubTransportMode(env);
  if (mode === "direct") {
    const token = directToken(env);
    if (!token) {
      throw new GitHubTransportConfigError(
        "Direct GitHub transport requires RONS_GITHUB_TOKEN, GITHUB_TOKEN, or GH_TOKEN.",
      );
    }
    return {
      mode,
      baseUrl: DIRECT_BASE_URL,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "RONS-Hub",
      },
    };
  }

  const lovableKey = value(env, "LOVABLE_API_KEY");
  const connectionKey = value(env, "GITHUB_API_KEY");
  if (!lovableKey || !connectionKey) {
    throw new GitHubTransportConfigError(
      "Lovable GitHub compatibility transport requires LOVABLE_API_KEY and GITHUB_API_KEY.",
    );
  }
  return {
    mode,
    baseUrl: LOVABLE_BASE_URL,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${lovableKey}`,
      "X-Connection-Api-Key": connectionKey,
    },
  };
}

export function assertGitHubTransportConfigured(
  env: NodeJS.ProcessEnv = process.env,
): GitHubTransportMode {
  return resolveGitHubTransportConfig(env).mode;
}

export async function githubRequest(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  if (!path.startsWith("/")) {
    throw new Error("GitHub request path must start with '/'.");
  }
  const config = resolveGitHubTransportConfig();
  const headers = new Headers(config.headers);
  new Headers(init.headers).forEach((v, k) => headers.set(k, v));
  return fetch(`${config.baseUrl}${path}`, {
    ...init,
    headers,
    redirect: init.redirect ?? "follow",
  });
}
export async function githubJson<T = unknown>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await githubRequest(path, init);
  const text = await response.text();
  if (!response.ok) throw new GitHubApiError(response.status, text);
  if (!text) return null as T;
  return JSON.parse(text) as T;
}
