import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  GitHubApiError,
  GitHubTransportConfigError,
  assertGitHubTransportConfigured,
  githubJson,
  githubRequest,
  resolveGitHubTransportMode,
} from "../../src/lib/github-provider.server";

const ENV_KEYS = [
  "RONS_GITHUB_TRANSPORT",
  "RONS_GITHUB_TOKEN",
  "GITHUB_TOKEN",
  "GH_TOKEN",
  "LOVABLE_API_KEY",
  "GITHUB_API_KEY",
] as const;
const saved = new Map<string, string | undefined>();
const realFetch = globalThis.fetch;

beforeEach(() => {
  for (const key of ENV_KEYS) {
    saved.set(key, process.env[key]);
    delete process.env[key];
  }
});
afterEach(() => {
  globalThis.fetch = realFetch;
  for (const key of ENV_KEYS) {
    const prior = saved.get(key);
    if (prior === undefined) delete process.env[key];
    else process.env[key] = prior;
  }
  saved.clear();
});

describe("RONS GitHub transport", () => {
  test("direct token wins when both direct and compatibility credentials exist", () => {
    process.env.RONS_GITHUB_TOKEN = "direct-secret";
    process.env.LOVABLE_API_KEY = "legacy-secret";
    process.env.GITHUB_API_KEY = "legacy-connection";
    expect(resolveGitHubTransportMode()).toBe("direct");
    expect(assertGitHubTransportConfigured()).toBe("direct");
  });

  test("legacy credentials auto-select compatibility mode only when no direct token exists", () => {
    process.env.LOVABLE_API_KEY = "legacy-secret";
    process.env.GITHUB_API_KEY = "legacy-connection";
    expect(resolveGitHubTransportMode()).toBe("lovable");
    expect(assertGitHubTransportConfigured()).toBe("lovable");
  });

  test("explicit direct mode refuses to fall back to legacy credentials", () => {
    process.env.RONS_GITHUB_TRANSPORT = "direct";
    process.env.LOVABLE_API_KEY = "legacy-secret";
    process.env.GITHUB_API_KEY = "legacy-connection";
    expect(() => assertGitHubTransportConfigured()).toThrow(GitHubTransportConfigError);
  });
});
describe("direct GitHub request", () => {
  test("targets api.github.com and keeps compatibility headers out", async () => {
    process.env.RONS_GITHUB_TRANSPORT = "direct";
    process.env.RONS_GITHUB_TOKEN = "direct-secret";
    let seenUrl = "";
    let seenHeaders = new Headers();
    globalThis.fetch = (async (input, init) => {
      seenUrl = String(input);
      seenHeaders = new Headers(init?.headers);
      return new Response(JSON.stringify({ login: "rons-test" }), { status: 200 });
    }) as typeof fetch;

    const result = await githubJson<{ login: string }>("/user", { method: "GET" });
    expect(result.login).toBe("rons-test");
    expect(seenUrl).toBe("https://api.github.com/user");
    expect(seenHeaders.get("authorization")).toBe("Bearer direct-secret");
    expect(seenHeaders.get("x-connection-api-key")).toBeNull();
    expect(seenHeaders.get("user-agent")).toBe("RONS-Hub");
  });

  test("non-success responses use the neutral GitHubApiError", async () => {
    process.env.RONS_GITHUB_TOKEN = "direct-secret";
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ message: "rate limited" }), { status: 429 })) as typeof fetch;
    await expect(githubJson("/rate-limit")).rejects.toBeInstanceOf(GitHubApiError);
  });
});
describe("Lovable compatibility isolation", () => {
  test("legacy mode stays confined to the provider boundary", async () => {
    process.env.RONS_GITHUB_TRANSPORT = "lovable";
    process.env.LOVABLE_API_KEY = "legacy-secret";
    process.env.GITHUB_API_KEY = "legacy-connection";
    let seenUrl = "";
    let seenHeaders = new Headers();
    globalThis.fetch = (async (input, init) => {
      seenUrl = String(input);
      seenHeaders = new Headers(init?.headers);
      return new Response("{}", { status: 200 });
    }) as typeof fetch;

    await githubRequest("/user");
    expect(seenUrl).toBe("https://connector-gateway.lovable.dev/github/user");
    expect(seenHeaders.get("authorization")).toBe("Bearer legacy-secret");
    expect(seenHeaders.get("x-connection-api-key")).toBe("legacy-connection");
  });

  test("all GitHub callers use the provider instead of embedding Lovable credentials", () => {
    const callers = [
      "src/lib/github-ci.functions.ts", "src/lib/github-health.functions.ts",
      "src/lib/github-pulls.functions.ts", "src/lib/github-releases.functions.ts",
      "src/lib/github-security.functions.ts", "src/lib/github.functions.ts",
      "src/routes/api/public/forms/create-issue.ts",
      "src/routes/api/public/hooks/ci-failure-alerts.ts",
    ];
    for (const rel of callers) {
      const source = readFileSync(rel, "utf8");
      expect(source).toContain("github-provider.server");
      expect(source).not.toContain("connector-gateway.lovable.dev/github");
      expect(source).not.toContain("LOVABLE_API_KEY");
      expect(source).not.toContain("GITHUB_API_KEY");
    }

    const provider = readFileSync("src/lib/github-provider.server.ts", "utf8");
    expect(provider.match(/connector-gateway\.lovable\.dev\/github/g)?.length).toBe(1);
  });
});
