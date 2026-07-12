/**
 * AppLink — typed wrapper around TanStack `<Link>`.
 *
 * Built with `createLink`, which returns a fully generic `LinkComponent`.
 * That preserves TanStack's inference for `to`, `params`, `search`, and
 * `from`, so `<AppLink to="/apps/submissions/$id" params={{ id }}>` still
 * type-checks the params object against the route.
 *
 * Because `to` is typed as a valid registered fullPath (i.e. `RoutePath`
 * from `@/lib/routes`), passing an unknown string like `"/auth"` is a
 * compile error at the call site — no separate registry lookup needed.
 *
 * Usage:
 *   import { AppLink } from "@/components/AppLink";
 *   <AppLink to={ROUTES.pricing}>Pricing</AppLink>
 *   <AppLink to="/apps/submissions/$id" params={{ id }}>View</AppLink>
 *
 * Prefer `AppLink` over the raw TanStack `Link` in all app code. The raw
 * `Link` is only used by infra files that must not depend on this wrapper
 * (root layout, the Back-to-Hub marker component).
 */
import { createLink, Link } from "@tanstack/react-router";
import { forwardRef, type ComponentPropsWithoutRef, type ReactNode } from "react";

type AnchorHostProps = Omit<ComponentPropsWithoutRef<"a">, "href"> & {
  children?: ReactNode;
};

const AnchorHost = forwardRef<HTMLAnchorElement, AnchorHostProps>(
  function AnchorHost(props, ref) {
    return <a ref={ref} {...props} />;
  }
);

export const AppLink = createLink(AnchorHost);

/** Escape hatch for infra files that intentionally bypass AppLink. */
export { Link as RawLink };
