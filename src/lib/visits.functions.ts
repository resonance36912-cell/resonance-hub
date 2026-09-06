import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

async function requireAdmin(userId: string) {
  const { data } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  if (!data) throw new Error("Forbidden: admin role required");
}

const RecordInput = z.object({
  path: z.string().min(1).max(2048),
  referrer: z.string().max(2048).optional().nullable(),
  session_id: z.string().min(1).max(120).optional().nullable(),
});

export const recordVisit = createServerFn({ method: "POST" })
  .validator((i: unknown) => RecordInput.parse(i))
  .handler(async ({ data }) => {
    let userAgent: string | null = null;
    let sourceIp: string | null = null;
    try {
      const req = getRequest();
      userAgent = req?.headers.get("user-agent") ?? null;
      sourceIp =
        req?.headers.get("cf-connecting-ip") ??
        req?.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
        null;
    } catch {
      /* ignore */
    }

    const { error } = await supabaseAdmin.from("site_visits").insert({
      path: data.path,
      referrer: data.referrer ?? null,
      session_id: data.session_id ?? null,
      user_agent: userAgent,
      source_ip: sourceIp,
    });
    if (error) {
      console.error("[visits] insert failed", error);
      return { ok: false };
    }
    return { ok: true };
  });

export type VisitRow = {
  id: string;
  created_at: string;
  path: string;
  referrer: string | null;
  source_ip: string | null;
  session_id: string | null;
  user_agent: string | null;
};

export type VisitStats = {
  total24h: number;
  total7d: number;
  totalAll: number;
  uniqueSessions24h: number;
  topPaths: { path: string; count: number }[];
  recent: VisitRow[];
};

export const getVisitStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<VisitStats> => {
    await requireAdmin(context.userId);

    const now = Date.now();
    const since24 = new Date(now - 24 * 60 * 60 * 1000).toISOString();
    const since7 = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();

    const [{ count: totalAll }, { count: total24h }, { count: total7d }] = await Promise.all([
      supabaseAdmin.from("site_visits").select("*", { count: "exact", head: true }),
      supabaseAdmin.from("site_visits").select("*", { count: "exact", head: true }).gte("created_at", since24),
      supabaseAdmin.from("site_visits").select("*", { count: "exact", head: true }).gte("created_at", since7),
    ]);

    const { data: last7Rows } = await supabaseAdmin
      .from("site_visits")
      .select("path,session_id,created_at")
      .gte("created_at", since24)
      .limit(5000);

    const sessions = new Set<string>();
    const pathCounts = new Map<string, number>();
    for (const r of last7Rows ?? []) {
      if (r.session_id) sessions.add(r.session_id);
      pathCounts.set(r.path, (pathCounts.get(r.path) ?? 0) + 1);
    }
    const topPaths = Array.from(pathCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([path, count]) => ({ path, count }));

    const { data: recent } = await supabaseAdmin
      .from("site_visits")
      .select("id,created_at,path,referrer,source_ip,session_id,user_agent")
      .order("created_at", { ascending: false })
      .limit(15);

    return {
      total24h: total24h ?? 0,
      total7d: total7d ?? 0,
      totalAll: totalAll ?? 0,
      uniqueSessions24h: sessions.size,
      topPaths,
      recent: (recent ?? []) as VisitRow[],
    };
  });
