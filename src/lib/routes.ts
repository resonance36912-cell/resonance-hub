/**
 * Typed route helpers.
 *
 * Central source of truth for navigation targets. All `<Link to>`,
 * `navigate({ to })`, and `redirect({ to })` calls should reference these
 * constants (or spread the `linkOptions` presets) so an invalid path like
 * "/auth" becomes a TypeScript error at authoring time, not a build failure
 * from `routeTree.gen.ts`.
 *
 * The `RoutePath` type is derived from the generated router registry, so it
 * automatically stays in sync with the files under `src/routes/`.
 */
import { linkOptions, type RegisteredRouter } from "@tanstack/react-router";

/** Union of every valid route path registered on the app router. */
export type RoutePath = keyof RegisteredRouter["routesByPath"];

/**
 * Compile-time guard: any string passed here must be a real route path.
 * Use inline when a plain string is required (e.g. building a `redirect`
 * search param or a `Response.redirect(...)` URL).
 */
export const routePath = <T extends RoutePath>(path: T): T => path;

/**
 * Named route constants. Prefer these over string literals.
 * Add entries here as new routes are introduced.
 */
export const ROUTES = {
  home: routePath("/"),
  login: routePath("/login"),
  apps: routePath("/apps"),
  appsSubmit: routePath("/apps/submit"),
  pricing: routePath("/pricing"),
  changelog: routePath("/changelog"),
  governance: routePath("/governance"),
  security: routePath("/security"),
  checkout: routePath("/checkout"),
  checkoutSuccess: routePath("/checkout/success"),
  checkoutCancel: routePath("/checkout/cancel"),
  accountBilling: routePath("/account/billing"),
  accountSubscriptions: routePath("/account/subscriptions"),
  accountInvoices: routePath("/account/invoices"),
  adminIndex: routePath("/admin"),
  adminLogin: routePath("/admin/login"),
  adminBilling: routePath("/admin/billing"),
  adminInvoices: routePath("/admin/invoices"),
  adminCredits: routePath("/admin/credits"),
} as const satisfies Record<string, RoutePath>;

/**
 * Reusable `linkOptions` presets for the most common destinations.
 * Spread into `<Link>` / `navigate` for full type-safe validation:
 *
 *   <Link {...LINKS.login}>Sign in</Link>
 *   navigate(LINKS.accountBilling)
 */
export const LINKS = {
  home: linkOptions({ to: ROUTES.home }),
  login: linkOptions({ to: ROUTES.login }),
  apps: linkOptions({ to: ROUTES.apps }),
  pricing: linkOptions({ to: ROUTES.pricing }),
  accountBilling: linkOptions({ to: ROUTES.accountBilling }),
  accountSubscriptions: linkOptions({ to: ROUTES.accountSubscriptions }),
  accountInvoices: linkOptions({ to: ROUTES.accountInvoices }),
  adminIndex: linkOptions({ to: ROUTES.adminIndex }),
  adminLogin: linkOptions({ to: ROUTES.adminLogin }),
} as const;
