import { createFileRoute, redirect } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ROUTES } from "@/lib/routes";
import { AppLink } from "@/components/AppLink";
import {
  listDeliveries,
  listSpokes,
  probeAllSpokes,
  probeAppFn,
  pushConfigToAll,
  pushConfigToApp,
} from "@/lib/hub-control.functions";
import {
  registerHubApp,
  rotateHubAppKey,
  setHubAppStatus,
} from "@/lib/rop-admin.functions";

export const Route = createFileRoute("/admin/spoke-health")({
  head: () => ({
    meta: [
      { title: "Spoke Health — Resonance" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: ROUTES.adminLogin });
    const { data: role } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", data.user.id)
      .eq("role", "admin")
      .maybeSingle();
    if (!role) throw redirect({ to: ROUTES.adminLogin });
  },
  component: SpokeHealth,
});

function statusColor(s: string | null) {
  if (!s) return "text-muted-foreground";
  if (s === "healthy" || s === "ok") return "text-green-600";
  if (s.startsWith("unhealthy") || s === "unreachable" || s.startsWith("http_")) return "text-red-600";
  return "text-yellow-600";
}

function SpokeHealth() {
  const qc = useQueryClient();
  const list = useServerFn(listSpokes);
  const deliveries = useServerFn(listDeliveries);
  const probeOne = useServerFn(probeAppFn);
  const probeAll = useServerFn(probeAllSpokes);
  const pushOne = useServerFn(pushConfigToApp);
  const pushAll = useServerFn(pushConfigToAll);
  const register = useServerFn(registerHubApp);
  const rotate = useServerFn(rotateHubAppKey);
  const setStatus = useServerFn(setHubAppStatus);

  const [slug, setSlug] = useState("");
  const [name, setName] = useState("");
  const [originUrl, setOriginUrl] = useState("");
  const [minted, setMinted] = useState<{ slug: string; raw: string; hmac: string } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const spokesQ = useQuery({
    queryKey: ["admin-spokes"],
    queryFn: () => list(),
    refetchInterval: 15000,
  });
  const delivQ = useQuery({
    queryKey: ["admin-spoke-deliveries"],
    queryFn: () => deliveries({ data: { limit: 50 } }),
    refetchInterval: 10000,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["admin-spokes"] });
    qc.invalidateQueries({ queryKey: ["admin-spoke-deliveries"] });
  };
  const probeOneMut = useMutation({ mutationFn: (id: string) => probeOne({ data: { appId: id } }), onSettled: invalidate });
  const pushOneMut = useMutation({ mutationFn: (id: string) => pushOne({ data: { appId: id } }), onSettled: invalidate });
  const probeAllMut = useMutation({ mutationFn: () => probeAll(), onSettled: invalidate });
  const pushAllMut = useMutation({ mutationFn: () => pushAll(), onSettled: invalidate });

  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <AppLink to={ROUTES.admin} className="text-sm text-muted-foreground hover:underline">← Admin</AppLink>
          <h1 className="mt-1 text-2xl font-semibold">Spoke Health & Control</h1>
          <p className="text-sm text-muted-foreground">
            Push config bundles and probe every registered spoke. See{" "}
            <a href="/docs/spoke-hub-control-contract" className="underline">the contract</a> for the endpoints spokes expose.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent"
            onClick={() => probeAllMut.mutate()}
            disabled={probeAllMut.isPending}
          >
            {probeAllMut.isPending ? "Probing…" : "Probe all"}
          </button>
          <button
            className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:bg-primary/90"
            onClick={() => pushAllMut.mutate()}
            disabled={pushAllMut.isPending}
          >
            {pushAllMut.isPending ? "Pushing…" : "Push to all"}
          </button>
        </div>
      </div>

      <section className="mb-8 overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left">
            <tr>
              <th className="px-3 py-2">Spoke</th>
              <th className="px-3 py-2">Origin</th>
              <th className="px-3 py-2">Control</th>
              <th className="px-3 py-2">Last push</th>
              <th className="px-3 py-2">Last health</th>
              <th className="px-3 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {spokesQ.isLoading && (
              <tr><td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">Loading…</td></tr>
            )}
            {(spokesQ.data ?? []).map((s) => (
              <tr key={s.id} className="border-t">
                <td className="px-3 py-2">
                  <div className="font-medium">{s.name}</div>
                  <div className="text-xs text-muted-foreground">{s.slug}</div>
                </td>
                <td className="px-3 py-2 text-xs">{s.origin_url ?? <span className="text-muted-foreground">not set</span>}</td>
                <td className="px-3 py-2 text-xs">
                  {s.control_enabled ? "enabled" : <span className="text-muted-foreground">disabled</span>}
                </td>
                <td className="px-3 py-2 text-xs">
                  <div className={statusColor(s.last_push_status)}>{s.last_push_status ?? "—"}</div>
                  <div className="text-muted-foreground">{s.last_push_at ? new Date(s.last_push_at).toLocaleString() : ""}</div>
                </td>
                <td className="px-3 py-2 text-xs">
                  <div className={statusColor(s.last_health_status)}>{s.last_health_status ?? "—"}</div>
                  <div className="text-muted-foreground">{s.last_health_at ? new Date(s.last_health_at).toLocaleString() : ""}</div>
                </td>
                <td className="px-3 py-2 text-right">
                  <div className="flex justify-end gap-2">
                    <button
                      className="rounded border px-2 py-1 text-xs hover:bg-accent"
                      onClick={() => probeOneMut.mutate(s.id)}
                      disabled={probeOneMut.isPending}
                    >Probe</button>
                    <button
                      className="rounded border px-2 py-1 text-xs hover:bg-accent"
                      onClick={() => pushOneMut.mutate(s.id)}
                      disabled={pushOneMut.isPending || !s.control_enabled}
                    >Push</button>
                  </div>
                </td>
              </tr>
            ))}
            {(spokesQ.data ?? []).length === 0 && !spokesQ.isLoading && (
              <tr><td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">No spokes registered.</td></tr>
            )}
          </tbody>
        </table>
      </section>

      <section className="rounded-lg border">
        <div className="border-b bg-muted/30 px-3 py-2 text-sm font-medium">Recent deliveries</div>
        <div className="max-h-[400px] overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-background text-left">
              <tr>
                <th className="px-3 py-2">Time</th>
                <th className="px-3 py-2">Kind</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">HTTP</th>
                <th className="px-3 py-2">Duration</th>
                <th className="px-3 py-2">Error</th>
              </tr>
            </thead>
            <tbody>
              {(delivQ.data ?? []).map((d) => (
                <tr key={d.id} className="border-t">
                  <td className="px-3 py-1.5">{new Date(d.created_at as string).toLocaleString()}</td>
                  <td className="px-3 py-1.5">{d.kind}</td>
                  <td className={`px-3 py-1.5 ${statusColor(d.status as string)}`}>{d.status}</td>
                  <td className="px-3 py-1.5">{d.http_status ?? "—"}</td>
                  <td className="px-3 py-1.5">{d.duration_ms ? `${d.duration_ms}ms` : "—"}</td>
                  <td className="px-3 py-1.5 text-muted-foreground">{d.error ?? ""}</td>
                </tr>
              ))}
              {(delivQ.data ?? []).length === 0 && (
                <tr><td colSpan={6} className="px-3 py-4 text-center text-muted-foreground">No deliveries yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
