/**
 * Timer contract for the `/checkout/success` auto-redirect.
 *
 * Locks two guarantees:
 *   1. The default delay is exactly `AUTO_REDIRECT_MS` (1800 ms). A silent
 *      change to that constant — the difference between "user sees the
 *      confirmation" and "page yanks out from under them" — fails here.
 *   2. Cancelling before the timer fires (the effect cleanup that runs
 *      when the user navigates away, or when phase leaves `succeeded`)
 *      prevents `navigate` and `assignHref` from ever being invoked.
 */
import { describe, expect, it } from "bun:test";
import {
  AUTO_REDIRECT_MS,
  scheduleCheckoutSuccessRedirect,
} from "../../src/lib/checkout-success-redirect";

type FakeTimer = { fn: () => void; delay: number; cancelled: boolean };

function makeFakeTimers() {
  const timers: FakeTimer[] = [];
  const setTimeoutImpl = ((fn: () => void, delay?: number) => {
    const t: FakeTimer = { fn, delay: delay ?? 0, cancelled: false };
    timers.push(t);
    return t as unknown as ReturnType<typeof setTimeout>;
  }) as unknown as typeof setTimeout;
  const clearTimeoutImpl = ((handle: unknown) => {
    const t = handle as FakeTimer;
    t.cancelled = true;
  }) as unknown as typeof clearTimeout;
  const fireAll = () => {
    for (const t of timers) {
      if (!t.cancelled) t.fn();
    }
  };
  return { timers, setTimeoutImpl, clearTimeoutImpl, fireAll };
}

describe("AUTO_REDIRECT_MS constant", () => {
  it("is exactly 1800ms — long enough to read the confirmation, short enough to feel snappy", () => {
    expect(AUTO_REDIRECT_MS).toBe(1800);
  });
});

describe("scheduleCheckoutSuccessRedirect — delay", () => {
  it("schedules navigation with AUTO_REDIRECT_MS by default", () => {
    const { timers, setTimeoutImpl, clearTimeoutImpl } = makeFakeTimers();
    scheduleCheckoutSuccessRedirect({
      target: { kind: "internal", to: "/pricing", hash: "passes" },
      navigate: () => {},
      assignHref: () => {},
      setTimeoutImpl,
      clearTimeoutImpl,
    });
    expect(timers).toHaveLength(1);
    expect(timers[0].delay).toBe(AUTO_REDIRECT_MS);
    expect(timers[0].delay).toBe(1800);
  });

  it("respects a caller-supplied delay override", () => {
    const { timers, setTimeoutImpl, clearTimeoutImpl } = makeFakeTimers();
    scheduleCheckoutSuccessRedirect({
      target: { kind: "internal", to: "/pricing", hash: "passes" },
      navigate: () => {},
      assignHref: () => {},
      delayMs: 42,
      setTimeoutImpl,
      clearTimeoutImpl,
    });
    expect(timers[0].delay).toBe(42);
  });
});

describe("scheduleCheckoutSuccessRedirect — fires the correct target", () => {
  it("internal target → calls navigate, not assignHref", () => {
    const { setTimeoutImpl, clearTimeoutImpl, fireAll } = makeFakeTimers();
    const navigateCalls: Array<{ to: string; hash: string | undefined }> = [];
    const hrefCalls: string[] = [];
    scheduleCheckoutSuccessRedirect({
      target: { kind: "internal", to: "/account/subscriptions", hash: undefined },
      navigate: (t) => navigateCalls.push(t),
      assignHref: (h) => hrefCalls.push(h),
      setTimeoutImpl,
      clearTimeoutImpl,
    });
    fireAll();
    expect(navigateCalls).toEqual([
      { to: "/account/subscriptions", hash: undefined },
    ]);
    expect(hrefCalls).toEqual([]);
  });

  it("external target → calls assignHref, not navigate", () => {
    const { setTimeoutImpl, clearTimeoutImpl, fireAll } = makeFakeTimers();
    const navigateCalls: unknown[] = [];
    const hrefCalls: string[] = [];
    scheduleCheckoutSuccessRedirect({
      target: { kind: "external", href: "https://example.com/dashboard" },
      navigate: (t) => navigateCalls.push(t),
      assignHref: (h) => hrefCalls.push(h),
      setTimeoutImpl,
      clearTimeoutImpl,
    });
    fireAll();
    expect(hrefCalls).toEqual(["https://example.com/dashboard"]);
    expect(navigateCalls).toEqual([]);
  });
});

describe("scheduleCheckoutSuccessRedirect — cancel before the timer fires", () => {
  it("cancel() prevents navigate from being called when the user leaves early", () => {
    const { setTimeoutImpl, clearTimeoutImpl, fireAll } = makeFakeTimers();
    const navigateCalls: unknown[] = [];
    const hrefCalls: unknown[] = [];
    const cancel = scheduleCheckoutSuccessRedirect({
      target: { kind: "internal", to: "/pricing", hash: "passes" },
      navigate: (t) => navigateCalls.push(t),
      assignHref: (h) => hrefCalls.push(h),
      setTimeoutImpl,
      clearTimeoutImpl,
    });
    cancel(); // simulate user navigating away before AUTO_REDIRECT_MS elapses
    fireAll();
    expect(navigateCalls).toEqual([]);
    expect(hrefCalls).toEqual([]);
  });

  it("cancel() on an external redirect prevents window.location.href assignment", () => {
    const { setTimeoutImpl, clearTimeoutImpl, fireAll } = makeFakeTimers();
    const hrefCalls: string[] = [];
    const cancel = scheduleCheckoutSuccessRedirect({
      target: { kind: "external", href: "https://example.com/dashboard" },
      navigate: () => {},
      assignHref: (h) => hrefCalls.push(h),
      setTimeoutImpl,
      clearTimeoutImpl,
    });
    cancel();
    fireAll();
    expect(hrefCalls).toEqual([]);
  });

  it("real-timer smoke: cancelling within the delay window never invokes navigate", async () => {
    let navigated = false;
    const cancel = scheduleCheckoutSuccessRedirect({
      target: { kind: "internal", to: "/pricing", hash: "passes" },
      navigate: () => {
        navigated = true;
      },
      assignHref: () => {
        navigated = true;
      },
      delayMs: 50,
    });
    cancel();
    await new Promise((r) => setTimeout(r, 80));
    expect(navigated).toBe(false);
  });
});
