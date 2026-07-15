/**
 * DocsLink — one component for every "link to a doc" call site.
 *
 * Rules enforced:
 *   • Internal targets MUST be a typed `RoutePath` (same union `AppLink` accepts),
 *     so `scripts/verify-route-strings.ts` and the TS route registry both stay green.
 *   • External targets MUST be absolute `http(s)://` URLs — never a bare "/…" path
 *     that would look like an internal route to the verifier.
 *
 * Usage:
 *   <DocsLink to={ROUTES.docsSpokeHubControlContract}>the contract</DocsLink>
 *   <DocsLink href="https://github.com/org/repo/blob/main/docs/x.md">the spec</DocsLink>
 *
 * External links automatically get `target="_blank"` + `rel="noreferrer noopener"`.
 */
import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { AppLink } from "@/components/AppLink";
import type { RoutePath } from "@/lib/routes";

type CommonProps = {
  children: ReactNode;
  className?: string;
};

type InternalProps = CommonProps & {
  to: RoutePath;
  href?: never;
  params?: ComponentPropsWithoutRef<typeof AppLink>["params"];
  search?: ComponentPropsWithoutRef<typeof AppLink>["search"];
};

type ExternalProps = CommonProps & {
  href: `http://${string}` | `https://${string}`;
  to?: never;
};

export type DocsLinkProps = InternalProps | ExternalProps;

export function DocsLink(props: DocsLinkProps) {
  if ("to" in props && props.to !== undefined) {
    const { to, children, className, params, search } = props;
    return (
      <AppLink to={to} params={params} search={search} className={className}>
        {children}
      </AppLink>
    );
  }

  const { href, children, className } = props;
  return (
    <a href={href} target="_blank" rel="noreferrer noopener" className={className}>
      {children}
    </a>
  );
}
