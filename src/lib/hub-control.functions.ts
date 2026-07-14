// Admin server functions for the hub → spoke control plane.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function assertAdmin(context: { supabase: unknown; userId: string }) {
  const supabase = context.supabase as { rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: boolean | null }> };
  const { data } = await supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" });
  if (!data) throw new Error("Forbidden");
}

export const pushConfigToApp = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { appId: string }) => z.object({ appId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { pushToApp } = await import("./hub-control/push.server");
    return await pushToApp(data.appId, "push_nudge", { reason: "manual" });
  });

export const pushConfigToAll = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { pushToApp } = await import("./hub-control/push.server");
    const { data } = await supabaseAdmin
      .from("hub_apps")
      .select("id")
      .eq("status", "active")
      .eq("control_enabled", true);
    const results = await Promise.all(
      (data ?? []).map((a) => pushToApp(a.id as string, "push_nudge", { reason: "broadcast" })),
    );
    return { attempted: results.length, ok: results.filter((r) => r.ok).length };
  });

export const probeAppFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { appId: string }) => z.object({ appId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { probeApp } = await import("./hub-control/push.server");
    return await probeApp(data.appId);
  });

export const probeAllSpokes = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { probeApp } = await import("./hub-control/push.server");
    const { data } = await supabaseAdmin.from("hub_apps").select("id").eq("status", "active");
    const results = await Promise.all((data ?? []).map((a) => probeApp(a.id as string)));
    return { attempted: results.length, ok: results.filter((r) => r.ok).length };
  });

export const listSpokes = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("hub_apps")
      .select("id, slug, name, status, origin_url, control_enabled, control_path, validate_path, last_push_at, last_push_status, last_health_at, last_health_status")
      .order("slug");
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const listDeliveries = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { appId?: string; limit?: number }) =>
    z.object({ appId: z.string().uuid().optional(), limit: z.number().int().min(1).max(200).optional() }).parse(d ?? {}),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let q = supabaseAdmin
      .from("hub_control_deliveries")
      .select("id, app_id, kind, status, http_status, error, duration_ms, created_at")
      .order("created_at", { ascending: false })
      .limit(data.limit ?? 50);
    if (data.appId) q = q.eq("app_id", data.appId);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return rows ?? [];
  });
