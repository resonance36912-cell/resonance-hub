/**
 * AppLink — typed wrapper around TanStack `<Link>`.
 *
 * Purpose: constrain the `to` prop to `RoutePath` (the union of every
 * registered fullPath from `routeTree.gen.ts`). Invalid strings like
 * `"/auth"` fail at authoring time instead of the build, and callers get
 * autocomplete for every real route.
 *
 * Dynamic-param routes (e.g. `/apps/submissions/$id`) are still supported:
 * their fullPath IS a member of `RoutePath`, and the `params` prop is
 * type-checked by TanStack's own inference chain because we forward
 * generics through `createLink`.
 *
 * Usage:
 *   <AppLink to={ROUTES.pricing}>Pricing</AppLink>
 *   <AppLink to="/apps/submissions/$id" params={{ id }}>View</AppLink>
 *
 * Prefer `AppLink` over the raw TanStack `Link` in all app code. The raw
 * `Link` remains available for internal infrastructure files (root layout,
 * the Back-to-Hub marker component) that must not depend on the ROUTES
 * registry.
 */
import { createLink, Link, type LinkComponent } from "@tanstack/react-router";
import { forwardRef, type ComponentPropsWithoutRef } from "react";
import type { RoutePath } from "@/lib/routes";

type AnchorProps = Omit<ComponentPropsWithoutRef<"a">, "href" | "children">;

// Anchor host that createLink attaches TanStack's typed props to. Kept as a
// forwardRef so `ref` typing lines up with the generated LinkComponent.
const AnchorHost = forwardRef<HTMLAnchorElement, AnchorProps & { children?: React.ReactNode }>(
  function AnchorHost(props, ref) {
    return <a ref={ref} {...props} />;
  }
);

const TypedLink = createLink(AnchorHost);

/**
 * Runtime narrowing: `to` is constrained to `RoutePath` (or a route object,
 * matching TanStack's own `to` shape). We intersect the generated component
 * type with a narrower `to` so autocomplete lists the registry and
 * unknown strings are rejected.
 */
type TypedLinkProps = Parameters<LinkComponent<typeof AnchorHost>>[0];
export type AppLinkProps = Omit<TypedLinkProps, "to"> & {
  to: RoutePath | (TypedLinkProps extends { to?: infer T } ? Extract<T, object> : never);
};

export const AppLink = TypedLink as unknown as (props: AppLinkProps) => React.ReactElement;

// Re-export the raw Link for the handful of infra files that need it.
export { Link as RawLink };
