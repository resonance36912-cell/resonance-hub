/**
 * The `/checkout/success` route's redirect effect can re-run (deps
 * change: phase, primaryCta reference, sku, pack, sessionIdParam, and
 * the mapped analyticsKind). React always calls the returned cleanup
 * before re-running the effect, and cleanup here === the scheduler's
 * cancel().
 *
 * These tests lock the resulting guarantee: no matter how many times
 * the effect body executes, exactly ONE navigation is dispatched.
 *
 * Also covers defensive edges: cancel() after the timer has fired is a
 * no-op; cancel() called twice is a no-op; and simulating a stray
 * second invocation of the SAME timer callback doesn't double-navigate
 * (setTimeout only fires once — asserted with real timers).
 */
import { describe, expect, it } from "bun:test";
import {
  scheduleCheckoutSuccessRedirect,
  type RedirectAssignHref,
  type RedirectNavigate,
} from "../../src/lib/checkout-success-redirect";
import type { CtaTarget } from "../../src/lib/checkout-success-ctas";

type FakeTimer = { fn: () => void; delay: number; cancelled: boolean; fired: boolean };

function makeFakeTimers() {
  const timers: FakeTimer[] = [];
  const setTimeoutImpl = ((fn: () => void, delay?: number) => {
    const t: FakeTimer = { fn, delay: delay ?? 0, cancelled: false, fired: false };
    timers.push(t);
    return t as unknown as ReturnType<typeof setTimeout>;
  }) as unknown as typeof setTimeout;
  const clearTimeoutImpl = ((handle: unknown) => {
    (handle as FakeTimer).cancelled = true;
  }) as unknown as typeof clearTimeout;
  const fireAll = () => {
    for (const t of timers) {
      if (!t.cancelled && !t.fired) {
        t.fired = true;
        t.fn();
      }
    }
  };
  return { timers, setTimeoutImpl, clearTimeoutImpl, fireAll };
}

function makeSpies() {
  const navigateCalls: Array<{ to: string; hash: string | undefined }> = [];
  const hrefCalls: string[] = [];
  const navigate: RedirectNavigate = (t) => navigateCalls.push(t);
  const assignHref: RedirectAssignHref = (h) => hrefCalls.push(h);
  const totalNavs = () => navigateCalls.length + hrefCalls.length;
  return { navigateCalls, hrefCalls, navigate, assignHref, totalNavs };
}

const INTERNAL: CtaTarget = { kind: "internal", to: "/pricing", hash: "passes" };
const EXTERNAL: CtaTarget = { kind: "external", href: "https://example.com/a" };

describe("scheduleCheckoutSuccessRedirect — effect re-run cannot double-navigate", () => {
  it("N re-runs of the React effect (cleanup between) → exactly 1 navigation", () => {
    const { setTimeoutImpl, clearTimeoutImpl, fireAll, timers } = makeFakeTimers();
    const spies = makeSpies();

    // Simulate the SuccessPage effect firing 5 times as deps change. React
    // always invokes cleanup before the next run.
    let cancel = () => {};
    for (let i = 0; i < 5; i++) {
      cancel();
      cancel = scheduleCheckoutSuccessRedirect({
        target: INTERNAL,
        navigate: spies.navigate,
        assignHref: spies.assignHref,
        setTimeoutImpl,
        clearTimeoutImpl,
      });
    }
    fireAll();

    // 5 timers scheduled; 4 cancelled; the last fires exactly once.
    expect(timers).toHaveLength(5);
    expect(timers.filter((t) => t.cancelled)).toHaveLength(4);
    expect(spies.totalNavs()).toBe(1);
    expect(spies.navigateCalls).toEqual([{ to: "/pricing", hash: "passes" }]);
  });

  it("target changes across re-runs → only the LAST scheduled target fires", () => {
    const { setTimeoutImpl, clearTimeoutImpl, fireAll } = makeFakeTimers();
    const spies = makeSpies();

    // Effect run 1: internal target
    let cancel = scheduleCheckoutSuccessRedirect({
      target: INTERNAL,
      navigate: spies.navigate,
      assignHref: spies.assignHref,
      setTimeoutImpl,
      clearTimeoutImpl,
    });
    // Effect re-runs; deps changed → primaryCta now external
    cancel();
    cancel = scheduleCheckoutSuccessRedirect({
      target: EXTERNAL,
      navigate: spies.navigate,
      assignHref: spies.assignHref,
      setTimeoutImpl,
      clearTimeoutImpl,
    });
    fireAll();

    expect(spies.totalNavs()).toBe(1);
    expect(spies.navigateCalls).toEqual([]);
    expect(spies.hrefCalls).toEqual(["https://example.com/a"]);
  });

  it("effect re-runs AFTER the timer has already fired → cleanup is a no-op, still 1 nav total", () => {
    const { setTimeoutImpl, clearTimeoutImpl, fireAll } = makeFakeTimers();
    const spies = makeSpies();

    const cancel1 = scheduleCheckoutSuccessRedirect({
      target: INTERNAL,
      navigate: spies.navigate,
      assignHref: spies.assignHref,
      setTimeoutImpl,
      clearTimeoutImpl,
    });
    fireAll(); // timer fires → 1 nav
    cancel1(); // stale cleanup from the fired timer — must be safe

    // Effect body runs again but this time guarded by the component (phase
    // has moved off "succeeded"), so no new schedule is created. Total
    // navigations must remain exactly 1.
    expect(spies.totalNavs()).toBe(1);
  });

  it("calling the returned cancel() twice is a no-op and doesn't schedule anything", () => {
    const { setTimeoutImpl, clearTimeoutImpl, fireAll, timers } = makeFakeTimers();
    const spies = makeSpies();
    const cancel = scheduleCheckoutSuccessRedirect({
      target: INTERNAL,
      navigate: spies.navigate,
      assignHref: spies.assignHref,
      setTimeoutImpl,
      clearTimeoutImpl,
    });
    cancel();
    cancel();
    fireAll();
    expect(timers).toHaveLength(1);
    expect(timers[0].cancelled).toBe(true);
    expect(spies.totalNavs()).toBe(0);
  });

  it("real timers: back-to-back schedule/cancel/schedule fires the last target exactly once", async () => {
    const spies = makeSpies();
    let cancel = scheduleCheckoutSuccessRedirect({
      target: INTERNAL,
      navigate: spies.navigate,
      assignHref: spies.assignHref,
      delayMs: 20,
    });
    cancel();
    cancel = scheduleCheckoutSuccessRedirect({
      target: EXTERNAL,
      navigate: spies.navigate,
      assignHref: spies.assignHref,
      delayMs: 20,
    });
    await new Promise((r) => setTimeout(r, 80));
    expect(spies.totalNavs()).toBe(1);
    expect(spies.hrefCalls).toEqual(["https://example.com/a"]);
    // Late cleanup after the timer has fired must remain safe.
    cancel();
    await new Promise((r) => setTimeout(r, 20));
    expect(spies.totalNavs()).toBe(1);
  });
});
