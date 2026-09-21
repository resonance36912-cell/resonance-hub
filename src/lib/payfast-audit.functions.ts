import { createServerFn } from "@tanstack/react-start";
import { requireRonsAuth } from "@/lib/rons-auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type LaunchRow = {
  id: string;
  created_at: string;
  user_id: string;
  sku: string;
  m_payment_id: string;
  amount_cents: number;
  currency: string;
  action_url: string;
  sandbox: boolean;
  source_ip: string | null;
  user_agent: string | null;
};

export type ItnRow = {
  id: string;
  received_at: string;
  signature_valid: boolean;
  server_validated: boolean;
  outcome: string;
  http_status: number;
  sku: string | null;
  user_id: string | null;
  amount_cents: number | null;
  payment_status: string | null;
  pf_payment_id: string | null;
  source_ip: string | null;
  error_message: string | null;
  raw_payload: Record<string, string>;
};

export type AuditTrace = {
  m_payment_id: string;
  launch: LaunchRow | null;
  itns: ItnRow[];
  sent_amount_cents: number | null;
  accepted_amount_cents: number | null;
  final_outcome: string | null;
  match: "match" | "mismatch" | "pending" | "rejected" | "no_launch";
};

async function requireAdmin(userId: string) {
  const { data } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  if (!data) throw new Error("Forbidden: admin role required");
}

export const listPayfastAudit = createServerFn({ method: "GET" })
  .middleware([requireRonsAuth])
  .handler(async ({ context }): Promise<{ traces: AuditTrace[] }> => {
    await requireAdmin(context.userId);

    const { data: launches, error: lerr } = await supabaseAdmin
      .from("payfast_launch_logs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200);
    if (lerr) throw new Error(lerr.message);

    const { data: itns, error: ierr } = await supabaseAdmin
      .from("payfast_itn_logs")
      .select("*")
      .order("received_at", { ascending: false })
      .limit(500);
    if (ierr) throw new Error(ierr.message);

    // Group ITNs by m_payment_id (extracted from raw_payload)
    const itnsByMpid = new Map<string, ItnRow[]>();
    for (const row of (itns ?? []) as ItnRow[]) {
      const mpid = row.raw_payload?.m_payment_id ?? `__orphan_${row.id}`;
      const list = itnsByMpid.get(mpid) ?? [];
      list.push(row);
      itnsByMpid.set(mpid, list);
    }

    const seenMpids = new Set<string>();
    const traces: AuditTrace[] = [];

    for (const launch of (launches ?? []) as LaunchRow[]) {
      seenMpids.add(launch.m_payment_id);
      const matched = itnsByMpid.get(launch.m_payment_id) ?? [];
      const accepted = matched.find((r) => r.http_status === 200);
      const latest = matched[0] ?? null;
      const acceptedAmount = accepted?.amount_cents ?? null;
      let match: AuditTrace["match"];
      if (matched.length === 0) match = "pending";
      else if (accepted) match = acceptedAmount === launch.amount_cents ? "match" : "mismatch";
      else match = "rejected";

      traces.push({
        m_payment_id: launch.m_payment_id,
        launch,
        itns: matched,
        sent_amount_cents: launch.amount_cents,
        accepted_amount_cents: acceptedAmount,
        final_outcome: latest?.outcome ?? null,
        match,
      });
    }

    // Orphan ITNs: received without a recorded launch (older data, or direct PayFast retries)
    for (const [mpid, rows] of itnsByMpid.entries()) {
      if (seenMpids.has(mpid)) continue;
      const accepted = rows.find((r) => r.http_status === 200);
      traces.push({
        m_payment_id: mpid,
        launch: null,
        itns: rows,
        sent_amount_cents: null,
        accepted_amount_cents: accepted?.amount_cents ?? null,
        final_outcome: rows[0]?.outcome ?? null,
        match: "no_launch",
      });
    }

    traces.sort((a, b) => {
      const ta = a.launch?.created_at ?? a.itns[0]?.received_at ?? "";
      const tb = b.launch?.created_at ?? b.itns[0]?.received_at ?? "";
      return tb.localeCompare(ta);
    });

    return { traces };
  });
