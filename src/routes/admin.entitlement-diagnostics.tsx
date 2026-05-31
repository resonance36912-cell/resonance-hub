import { createFileRoute, redirect, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { listEntitlementChecks } from "@/lib/entitlement-admin.functions";

export const Route = createFileRoute("/admin/entitlement-diagnostics")({
  head: () => ({
    meta: [
      { title: "Entitlement Diagnostics — Admin" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/admin/login" });
    const { data: role } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", data.user.id)
      .eq("role", "admin")
      .maybeSingle();
    if (!role) throw redirect({ to: "/admin/login" });
  },
  component: Page,
});

function Page() {
  const fetchLogs = useServerFn(listEntitlementChecks);
  const { data, isLoading, error } = useQuery({
    queryKey: ["admin-entitlement-log"],
    queryFn: () => fetchLogs(),
    refetchInterval: 15000,
  });

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-6xl px-6 py-12">
        <div className="mb-6 flex items-end justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">
              Resonance Admin
            </p>
            <h1 className="mt-2 text-3xl font-semibold">Entitlement Diagnostics</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Last 50 entitlement checks across all spoke apps. Refreshes every 15s.
            </p>
          </div>
          <Link
            to="/admin"
            className="rounded-lg border border-border bg-card px-4 py-2 text-sm hover:bg-accent"
          >
            ← Admin home
          </Link>
        </div>

        {isLoading && <p className="text-muted-foreground">Loading…</p>}
        {error && (
          <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-4 text-red-300">
            {(error as Error).message}
          </div>
        )}
        {data && data.rows.length === 0 && (
          <p className="text-sm text-muted-foreground">No entitlement checks yet.</p>
        )}
        {data && data.rows.length > 0 && (
          <div className="overflow-x-auto rounded-xl border border-border bg-card">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-left text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">When</th>
                  <th className="px-3 py-2">User</th>
                  <th className="px-3 py-2">App</th>
                  <th className="px-3 py-2">Tier</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Source</th>
                  <th className="px-3 py-2">Error</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.id} className="border-t border-border">
                    <td className="px-3 py-2 font-mono text-xs">
                      {new Date(r.created_at).toLocaleString()}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">
                      {r.user_id ? r.user_id.slice(0, 8) + "…" : "—"}
                    </td>
                    <td className="px-3 py-2">{r.app}</td>
                    <td className="px-3 py-2">{r.tier ?? "—"}</td>
                    <td className="px-3 py-2 text-xs">{r.status}</td>
                    <td className="px-3 py-2 text-xs">{r.source ?? "—"}</td>
                    <td className="px-3 py-2 text-xs text-red-400">{r.error ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
