// Unit tests for fetchRpcWithRetry. Stubs global fetch so we can assert
// retry/backoff behaviour without hitting the dev server.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { fetchRpcWithRetry } from "./security-scan-retry";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function stub(sequence: Array<() => Promise<Response> | Response>) {
  let i = 0;
  const calls: Array<Parameters<typeof fetch>> = [];
  globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
    calls.push(args);
    const step = sequence[Math.min(i, sequence.length - 1)];
    i++;
    return step();
  }) as typeof fetch;
  return { calls: () => calls, invocations: () => i };
}

describe("fetchRpcWithRetry", () => {
  test("returns 200 responses immediately without retrying", async () => {
    const s = stub([() => new Response("ok", { status: 200 })]);
    const res = await fetchRpcWithRetry("http://x", undefined, {
      baseMs: 1,
      capMs: 1,
      onRetry: () => {},
    });
    expect(res.status).toBe(200);
    expect(s.invocations()).toBe(1);
  });

  test("does NOT retry 4xx (auth/validation envelopes)", async () => {
    // 401/403/400 are legitimate serverFn contract responses — tests
    // assert on them, so retries would mask real behaviour.
    for (const status of [400, 401, 403, 404]) {
      const s = stub([() => new Response("", { status })]);
      const res = await fetchRpcWithRetry("http://x", undefined, {
        baseMs: 1,
        capMs: 1,
        onRetry: () => {},
      });
      expect(res.status).toBe(status);
      expect(s.invocations()).toBe(1);
    }
  });

  test("retries 5xx and eventually succeeds", async () => {
    const s = stub([
      () => new Response("", { status: 502 }),
      () => new Response("", { status: 503 }),
      () => new Response("ok", { status: 200 }),
    ]);
    const res = await fetchRpcWithRetry("http://x", undefined, {
      attempts: 3,
      baseMs: 1,
      capMs: 1,
      onRetry: () => {},
    });
    expect(res.status).toBe(200);
    expect(s.invocations()).toBe(3);
  });

  test("retries 429 rate-limited responses", async () => {
    const s = stub([
      () => new Response("", { status: 429 }),
      () => new Response("ok", { status: 200 }),
    ]);
    const res = await fetchRpcWithRetry("http://x", undefined, {
      attempts: 3,
      baseMs: 1,
      capMs: 1,
      onRetry: () => {},
    });
    expect(res.status).toBe(200);
    expect(s.invocations()).toBe(2);
  });

  test("retries thrown network errors", async () => {
    const s = stub([
      () => Promise.reject(new Error("ECONNRESET")),
      () => new Response("ok", { status: 200 }),
    ]);
    const res = await fetchRpcWithRetry("http://x", undefined, {
      attempts: 3,
      baseMs: 1,
      capMs: 1,
      onRetry: () => {},
    });
    expect(res.status).toBe(200);
    expect(s.invocations()).toBe(2);
  });

  test("returns the final retryable response after exhausting attempts", async () => {
    const s = stub([() => new Response("nope", { status: 503 })]);
    const res = await fetchRpcWithRetry("http://x", undefined, {
      attempts: 3,
      baseMs: 1,
      capMs: 1,
      onRetry: () => {},
    });
    expect(res.status).toBe(503);
    expect(s.invocations()).toBe(3);
  });

  test("throws the last error when every attempt throws", async () => {
    stub([() => Promise.reject(new Error("boom"))]);
    await expect(
      fetchRpcWithRetry("http://x", undefined, {
        attempts: 2,
        baseMs: 1,
        capMs: 1,
        onRetry: () => {},
      }),
    ).rejects.toThrow("boom");
  });

  test("attempts=1 disables retries", async () => {
    const s = stub([() => new Response("", { status: 502 })]);
    const res = await fetchRpcWithRetry("http://x", undefined, {
      attempts: 1,
      baseMs: 1,
      capMs: 1,
      onRetry: () => {},
    });
    expect(res.status).toBe(502);
    expect(s.invocations()).toBe(1);
  });

  test("calls onRetry with attempt index, reason, and delay", async () => {
    const events: Array<{ attempt: number; reason: string; delayMs: number }> =
      [];
    stub([
      () => new Response("", { status: 502 }),
      () => Promise.reject(new Error("neterr")),
      () => new Response("ok", { status: 200 }),
    ]);
    await fetchRpcWithRetry("http://x", undefined, {
      attempts: 3,
      baseMs: 1,
      capMs: 1,
      onRetry: (info) => events.push(info),
    });
    expect(events).toHaveLength(2);
    expect(events[0].attempt).toBe(1);
    expect(events[0].reason).toBe("HTTP 502");
    expect(events[1].attempt).toBe(2);
    expect(events[1].reason).toContain("neterr");
    expect(events[0].delayMs).toBeGreaterThanOrEqual(0);
  });
});
