/**
 * Auto-redirect scheduler for `/checkout/success`.
 *
 * Extracted from the route component so the exact delay and the
 * cancel-on-unmount behavior can be unit-tested without a browser.
 *
 * Contract:
 *   • Only navigates once, after `delayMs` (default `AUTO_REDIRECT_MS`).
 *   • The returned cleanup cancels the pending navigation. Calling it
 *     before the timer fires MUST prevent `navigate` / `assignHref` from
 *     ever being invoked — this is the guard that stops us from ripping
 *     the user off a page they navigated to.
 */
import type { CtaTarget } from "./checkout-success-ctas";

export const AUTO_REDIRECT_MS = 1800;

export type RedirectNavigate = (target: {
  to: string;
  hash: string | undefined;
}) => void;

export type RedirectAssignHref = (href: string) => void;

export function scheduleCheckoutSuccessRedirect({
  target,
  navigate,
  assignHref,
  delayMs = AUTO_REDIRECT_MS,
  setTimeoutImpl = setTimeout,
  clearTimeoutImpl = clearTimeout,
}: {
  target: CtaTarget;
  navigate: RedirectNavigate;
  assignHref: RedirectAssignHref;
  delayMs?: number;
  setTimeoutImpl?: typeof setTimeout;
  clearTimeoutImpl?: typeof clearTimeout;
}): () => void {
  const handle = setTimeoutImpl(() => {
    if (target.kind === "external") {
      assignHref(target.href);
    } else {
      navigate({ to: target.to, hash: target.hash });
    }
  }, delayMs);
  return () => clearTimeoutImpl(handle);
}
