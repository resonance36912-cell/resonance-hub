import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { requireRonsAuth, resolveRonsRequestCredential } from "@/lib/rons-auth-middleware";
import { fetchPlanChangeRows } from "@/lib/backend-provider.server";

export type PlanChangeRow = {
  id: string;
  from_app: string | null;
  from_tier: string | null;
  to_app: string;
  to_tier: string;
  change_type: "upgrade" | "downgrade" | "sidegrade" | "initial" | "supersede" | "cancel";
  reason: string | null;
  pf_payment_id: string | null;
  created_at: string;
};

/**
 * Returns the caller's plan-change history (most recent first).
 * RLS on public.plan_changes scopes rows to auth.uid().
 */
export const getMyPlanChanges = createServerFn({ method: "GET" })
  .middleware([requireRonsAuth])
  .handler(async ({ context }): Promise<{ rows: PlanChangeRow[] }> => {
    const request = getRequest();
    const credential = request ? resolveRonsRequestCredential(request) : null;
    if (!credential) throw new Error("Authenticated request credential unavailable");
    const rows = await fetchPlanChangeRows(credential, context.userId);
    return { rows: rows as PlanChangeRow[] };
  });
