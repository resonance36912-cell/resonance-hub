import { createFileRoute, redirect } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ROUTES } from "@/lib/routes";
import { AppLink } from "@/components/AppLink";
import { DocsLink } from "@/components/DocsLink";
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
  const registerMut = useMutation({
    mutationFn: (v: { slug: string; name: string; origin_url: string }) => register({ data: v }),
    onSuccess: (res) => {
      setMinted({ slug: res.app.slug, raw: res.raw_signing_key, hmac: res.hmac_secret });
      setSlug(""); setName(""); setOriginUrl("");
      invalidate();
    },
  });
  const rotateMut = useMutation({
    mutationFn: (id: string) => rotate({ data: { id } }),
    onSuccess: (res, id) => {
      const app = spokesQ.data?.find((a) => a.id === id);
      setMinted({ slug: app?.slug ?? id, raw: res.raw_signing_key, hmac: res.hmac_secret });
      invalidate();
    },
  });
  const statusMut = useMutation({
    mutationFn: (v: { id: string; status: "active" | "paused" | "revoked" }) => setStatus({ data: v }),
    onSettled: invalidate,
  });

  const copy = async (label: string, val: string) => {
    try { await navigator.clipboard.writeText(val); setCopied(label); setTimeout(() => setCopied(null), 1500); } catch { /* noop */ }
  };

  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <AppLink to={ROUTES.admin} className="text-sm text-muted-foreground hover:underline">← Admin</AppLink>
          <h1 className="mt-1 text-2xl font-semibold">Spoke Health & Control</h1>
          <p className="text-sm text-muted-foreground">
            Push config bundles and probe every registered spoke. See{" "}
            <DocsLink to={ROUTES.docsSpokeHubControlContract} className="underline">the contract</DocsLink> for the endpoints spokes expose.
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
            className="rounded-md bg-primary-surface px-3 py-1.5 text-sm text-primary-foreground hover:bg-primary-surface-hover"
            onClick={() => pushAllMut.mutate()}
            disabled={pushAllMut.isPending}
          >
            {pushAllMut.isPending ? "Pushing…" : "Push to all"}
          </button>
        </div>
      </div>

      {minted && (
        <section className="mb-6 rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-4">
          <div className="flex items-start justify-between gap-4">
            <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-300">
              New signing material for <span className="font-mono">{minted.slug}</span> — copy it now. It will NOT be shown again.
            </p>
            <button onClick={() => setMinted(null)} className="rounded border border-emerald-500/40 px-2 py-1 text-xs hover:bg-emerald-500/20">
              I've stored it
            </button>
          </div>
          <div className="mt-3 space-y-2">
            {[
              { k: "HUB_SIGNING_KEY (raw)", v: minted.raw },
              { k: "HMAC secret (used to sign requests)", v: minted.hmac },
            ].map(({ k, v }) => (
              <div key={k} className="flex items-center gap-2">
                <span className="min-w-[220px] text-xs text-muted-foreground">{k}</span>
                <code className="flex-1 truncate rounded bg-background px-2 py-1 font-mono text-xs">{v}</code>
                <button
                  onClick={() => copy(k, v)}
                  className="rounded border px-2 py-1 text-xs hover:bg-accent"
                >{copied === k ? "Copied" : "Copy"}</button>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="mb-8 rounded-lg border p-4">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Register a spoke</h2>
        <form
          className="mt-3 grid gap-2 sm:grid-cols-4"
          onSubmit={(e) => {
            e.preventDefault();
            registerMut.mutate({ slug, name, origin_url: originUrl });
          }}
        >
          <input required value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="slug (e.g. sync_vision)" className="rounded border bg-background px-3 py-2 text-sm" />
          <input required value={name} onChange={(e) => setName(e.target.value)} placeholder="display name" className="rounded border bg-background px-3 py-2 text-sm" />
          <input value={originUrl} onChange={(e) => setOriginUrl(e.target.value)} placeholder="origin url (optional)" className="rounded border bg-background px-3 py-2 text-sm" />
          <button disabled={registerMut.isPending} className="rounded bg-primary-surface px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">
            {registerMut.isPending ? "Minting…" : "Register & mint key"}
          </button>
        </form>
        {registerMut.error && <p className="mt-2 text-xs text-red-500">{(registerMut.error as Error).message}</p>}
      </section>

      <section className="mb-8 overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left">
            <tr>
              <th className="px-3 py-2">Spoke</th>
              <th className="px-3 py-2">Origin</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Last push</th>
              <th className="px-3 py-2">Last health</th>
              <th className="px-3 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {spokesQ.isLoading && (
              <tr><td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">Loading…</td></tr>
            )}
            {(spokesQ.data ?? []).map((s) => {
              const revoked = s.status === "revoked";
              return (
                <tr key={s.id} className={`border-t ${revoked ? "opacity-60" : ""}`}>
                  <td className="px-3 py-2">
                    <div className="font-medium">{s.name}</div>
                    <div className="text-xs text-muted-foreground">{s.slug}</div>
                    <div className="mt-1 font-mono text-[10px] text-muted-foreground">{s.id}</div>
                  </td>
                  <td className="px-3 py-2 text-xs">{s.origin_url ?? <span className="text-muted-foreground">not set</span>}</td>
                  <td className="px-3 py-2 text-xs">
                    <select
                      value={s.status}
                      onChange={(e) => {
                        const next = e.target.value as "active" | "paused" | "revoked";
                        if (next === "revoked" && !confirm(`Revoke ${s.slug}? Its HMAC key will stop working immediately.`)) return;
                        statusMut.mutate({ id: s.id, status: next });
                      }}
                      className="rounded border bg-background px-2 py-1 text-xs"
                    >
                      <option value="active">active</option>
                      <option value="paused">paused</option>
                      <option value="revoked">revoked</option>
                    </select>
                    <div className="mt-1 text-muted-foreground">{s.control_enabled ? "control on" : "control off"}</div>
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
                    <div className="flex flex-wrap justify-end gap-2">
                      <button
                        className="rounded border px-2 py-1 text-xs hover:bg-accent"
                        onClick={() => probeOneMut.mutate(s.id)}
                        disabled={probeOneMut.isPending || revoked}
                      >Probe</button>
                      <button
                        className="rounded border px-2 py-1 text-xs hover:bg-accent"
                        onClick={() => pushOneMut.mutate(s.id)}
                        disabled={pushOneMut.isPending || !s.control_enabled || revoked}
                      >Push</button>
                      <button
                        className="rounded border border-amber-500/50 px-2 py-1 text-xs text-amber-700 hover:bg-amber-500/10 dark:text-amber-300"
                        onClick={() => {
                          if (confirm(`Rotate HMAC key for ${s.slug}? Old key stops working immediately.`)) {
                            rotateMut.mutate(s.id);
                          }
                        }}
                        disabled={rotateMut.isPending}
                      >Rotate key</button>
                    </div>
                  </td>
                </tr>
              );
            })}
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
