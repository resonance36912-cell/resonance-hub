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
import { linkOptions } from "@tanstack/react-router";
import type { FileRouteTypes } from "../routeTree.gen";

/** Union of every valid navigation target registered on the app router. */
export type RoutePath = FileRouteTypes["to"];

/**
 * Reject trailing-slash literals (except the root "/") at the type level so
 * mistakes like "/admin/" never re-enter the route union. Pairs with the
 * runtime check in `scripts/verify-route-strings.ts`.
 */
export type NoTrailingSlash<T> = T extends "/"
  ? T
  : T extends `${string}/`
    ? never
    : T;

/**
 * Compile-time guard: any string passed here must be a real route path AND
 * must not carry a trailing slash (except the root "/"). Use inline when a
 * plain string is required (e.g. building a `redirect` search param or a
 * `Response.redirect(...)` URL).
 */
export const routePath = <T extends RoutePath>(
  path: T & NoTrailingSlash<T>,
): T => path;

/**
 * Named route constants. One entry per static (non-parameterized) route
 * registered on the app router. Auto-audited by
 * `scripts/verify-route-strings.ts` — adding a new route in `src/routes/`
 * should trigger a follow-up here.
 *
 * Dynamic routes (`/foo/$id`) are intentionally NOT here: they require
 * `<Link to="..." params={{ ... }}>` at the call site so TanStack can
 * type-check `params`. Use string literals for those.
 */
export const ROUTES = {
  home: routePath("/"),

  // Marketing / info
  apps: routePath("/apps"),
  appsSubmit: routePath("/apps/submit"),
  changelog: routePath("/changelog"),
  docsSpokeHubControlContract: routePath("/docs/spoke-hub-control-contract"),
  governance: routePath("/governance"),
  governanceLog: routePath("/governance/log"),
  legalGovernance: routePath("/legal/governance"),
  login: routePath("/login"),
  mcp: routePath("/mcp"),
  pricing: routePath("/pricing"),
  rcgf: routePath("/rcgf"),
  sitemapXml: routePath("/sitemap.xml"),
  updatesPreview: routePath("/updates/preview"),

  // Per-app pricing anchors
  creativeStudioPricing: routePath("/creative-studio/pricing"),
  epublisherPricing: routePath("/epublisher/pricing"),
  syncVisionPricing: routePath("/sync-vision/pricing"),
  youtubeOptimizerPricing: routePath("/youtube-optimizer/pricing"),

  // Checkout
  checkout: routePath("/checkout"),
  checkoutSuccess: routePath("/checkout/success"),
  checkoutCancel: routePath("/checkout/cancel"),

  // Email
  emailUnsubscribe: routePath("/email/unsubscribe"),

  // Account (user)
  accountBilling: routePath("/account/billing"),
  accountDebug: routePath("/account/debug"),
  accountInvoices: routePath("/account/invoices"),
  accountSubscriptions: routePath("/account/subscriptions"),
  accountPrivacy: routePath("/account/privacy"),

  admin: routePath("/admin"),

  adminAppSubmissions: routePath("/admin/app-submissions"),
  adminBilling: routePath("/admin/billing"),
  adminCredits: routePath("/admin/credits"),
  adminEmailDomain: routePath("/admin/email-domain"),
  adminEmails: routePath("/admin/emails"),
  adminEntitlementDiagnostics: routePath("/admin/entitlement-diagnostics"),
  adminGovernance: routePath("/admin/governance"),
  adminInvoices: routePath("/admin/invoices"),
  adminLogin: routePath("/admin/login"),
  adminPayfastAudit: routePath("/admin/payfast-audit"),
  adminReconciliation: routePath("/admin/reconciliation"),
  adminRevenue: routePath("/admin/revenue"),
  adminRop: routePath("/admin/rop"),
  adminSpokeHealth: routePath("/admin/spoke-health"),
  adminWebhooks: routePath("/admin/webhooks"),

  // Tools
  toolsCodex: routePath("/tools/codex"),
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
  // `/login` declares `validateSearch: { next }`, so linkOptions must
  // supply a search object. `next: undefined` is a valid no-op payload.
  login: linkOptions({ to: ROUTES.login, search: { next: "/" } }),
  apps: linkOptions({ to: ROUTES.apps }),
  pricing: linkOptions({ to: ROUTES.pricing }),
  accountBilling: linkOptions({ to: ROUTES.accountBilling }),
  accountSubscriptions: linkOptions({ to: ROUTES.accountSubscriptions }),
  accountInvoices: linkOptions({ to: ROUTES.accountInvoices }),
  admin: linkOptions({ to: ROUTES.admin }),
  adminLogin: linkOptions({ to: ROUTES.adminLogin }),
} as const;
