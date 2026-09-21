import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";

type Next = (options?: unknown) => Promise<unknown>;
type Handler = (input: { next: Next }) => Promise<unknown>;

function fixture(browser: boolean, token: string | null = null, providerError = false) {
  let calls = 0;
  const context: Record<string, unknown> = {
    createMiddleware: () => ({ client: (handler: Handler) => handler }),
    ronsAuth: {
      getSession: async () => {
        calls++;
        if (providerError) throw new Error("provider unavailable");
        return { data: { session: token ? { access_token: token } : null } };
      },
    },
  };
  if (browser) context.window = {};
  const source = readFileSync("src/integrations/supabase/auth-attacher.ts", "utf8")
    .replace(/^import[^\r\n]*\r?$/gm, "")
    .replace("export const attachSupabaseAuth =", "globalThis.handler =");
  vm.runInNewContext(source, context, { timeout: 1000 });
  return { handler: context.handler as Handler, calls: () => calls };
}

describe("browser token attachment does not initialize hosted auth during SSR", () => {
  test("SSR reaches next without reading a browser session", async () => {
    const f = fixture(false, null, true);
    let options: unknown = "not called";
    const result = await f.handler({
      next: async (value) => {
        options = value;
        return "public SSR";
      },
    });
    expect(result).toBe("public SSR");
    expect(options).toBeUndefined();
    expect(f.calls()).toBe(0);
  });
  test("SSR does not swallow server authorization errors", async () => {
    const f = fixture(false);
    await expect(
      f.handler({
        next: async () => {
          throw new Error("Unauthorized");
        },
      }),
    ).rejects.toThrow("Unauthorized");
    expect(f.calls()).toBe(0);
  });
  test("browser still attaches its session bearer", async () => {
    const f = fixture(true, "test-session-value");
    const result = await f.handler({ next: async (value) => value });
    expect(JSON.parse(JSON.stringify(result))).toEqual({
      headers: { Authorization: "Bearer test-session-value" },
    });
    expect(f.calls()).toBe(1);
  });
  test("signed-out browser does not invent credentials", async () => {
    const f = fixture(true);
    const result = await f.handler({ next: async (value) => value });
    expect(JSON.parse(JSON.stringify(result))).toEqual({ headers: {} });
    expect(f.calls()).toBe(1);
  });
  test("browser provider errors propagate and do not call next", async () => {
    const f = fixture(true, null, true);
    let nextCalls = 0;
    await expect(
      f.handler({
        next: async () => {
          nextCalls++;
        },
      }),
    ).rejects.toThrow("provider unavailable");
    expect(nextCalls).toBe(0);
  });
});
