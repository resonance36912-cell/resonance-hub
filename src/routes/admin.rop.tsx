import { createFileRoute, redirect } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  listHubApps,
  listHubOutcomes,
  listHubSuggestions,
  registerHubApp,
  rotateHubAppKey,
  setHubAppStatus,
  updateHubSuggestion,
} from "@/lib/rop-admin.functions";

export const Route = createFileRoute("/admin/rop")({
  head: () => ({
    meta: [
      { title: "Resonance Optimization Protocol — Admin" },
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
  component: RopAdmin,
});

function RopAdmin() {
  const qc = useQueryClient();
  const listApps = useServerFn(listHubApps);
  const register = useServerFn(registerHubApp);
  const rotate = useServerFn(rotateHubAppKey);
  const setStatus = useServerFn(setHubAppStatus);
  const listSuggestions = useServerFn(listHubSuggestions);
  const updateSuggestion = useServerFn(updateHubSuggestion);
  const listOutcomes = useServerFn(listHubOutcomes);

  const appsQ = useQuery({ queryKey: ["rop-apps"], queryFn: () => listApps() });
  const sugQ = useQuery({ queryKey: ["rop-suggestions"], queryFn: () => listSuggestions() });
  const outQ = useQuery({ queryKey: ["rop-outcomes"], queryFn: () => listOutcomes() });

  const [slug, setSlug] = useState("");
  const [name, setName] = useState("");
  const [publicUrl, setPublicUrl] = useState("");
  const [minted, setMinted] = useState<{ slug: string; raw: string; hmac: string } | null>(null);

  const registerMut = useMutation({
    mutationFn: (vars: { slug: string; name: string; public_url: string }) =>
      register({ data: vars }),
    onSuccess: (res) => {
      setMinted({ slug: res.app.slug, raw: res.raw_signing_key, hmac: res.hmac_secret });
      setSlug(""); setName(""); setPublicUrl("");
      qc.invalidateQueries({ queryKey: ["rop-apps"] });
    },
  });

  const rotateMut = useMutation({
    mutationFn: (id: string) => rotate({ data: { id } }),
    onSuccess: (res, id) => {
      const app = appsQ.data?.apps.find((a) => a.id === id);
      setMinted({ slug: app?.slug ?? id, raw: res.raw_signing_key, hmac: res.hmac_secret });
      qc.invalidateQueries({ queryKey: ["rop-apps"] });
    },
  });

  const statusMut = useMutation({
    mutationFn: (vars: { id: string; status: "active" | "paused" | "revoked" }) =>
      setStatus({ data: vars }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["rop-apps"] }),
  });

  const suggestionMut = useMutation({
    mutationFn: (vars: {
      id: string;
      status?: "pending" | "approved" | "applied" | "reverted" | "rejected";
      broadcast?: boolean;
    }) => updateSuggestion({ data: vars }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["rop-suggestions"] }),
  });

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-7xl px-6 py-12 space-y-12">
        <header>
          <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">Resonance Admin</p>
          <h1 className="mt-2 text-3xl font-semibold">Optimization Protocol</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Register spoke apps, mint HMAC signing keys, review cross-app suggestions, and monitor outcomes.
          </p>
        </header>

        {/* Mint reveal */}
        {minted && (
          <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-5">
            <p className="text-sm font-semibold text-emerald-300">
              New signing material for {minted.slug} — store now, it won't be shown again.
            </p>
            <div className="mt-3 space-y-2 font-mono text-xs">
              <KeyRow label="HUB_SIGNING_KEY (raw)" value={minted.raw} />
              <KeyRow label="HMAC secret (sha256 hex — actual secret used to sign requests)" value={minted.hmac} />
            </div>
            <button
              onClick={() => setMinted(null)}
              className="mt-4 rounded border border-emerald-500/40 px-3 py-1 text-xs text-emerald-200 hover:bg-emerald-500/20"
            >
              I've stored it
            </button>
          </div>
        )}

        {/* Register form */}
        <section className="rounded-xl border border-border bg-card p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Register an app
          </h2>
          <form
            className="mt-4 grid sm:grid-cols-4 gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              registerMut.mutate({ slug, name, public_url: publicUrl });
            }}
          >
            <input
              required value={slug} onChange={(e) => setSlug(e.target.value)}
              placeholder="slug (e.g. sync_vision)"
              className="rounded border border-border bg-background px-3 py-2 text-sm"
            />
            <input
              required value={name} onChange={(e) => setName(e.target.value)}
              placeholder="display name"
              className="rounded border border-border bg-background px-3 py-2 text-sm"
            />
            <input
              value={publicUrl} onChange={(e) => setPublicUrl(e.target.value)}
              placeholder="public url (optional)"
              className="rounded border border-border bg-background px-3 py-2 text-sm"
            />
            <button
              disabled={registerMut.isPending}
              className="rounded bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              {registerMut.isPending ? "Minting…" : "Register & mint key"}
            </button>
          </form>
          {registerMut.error && (
            <p className="mt-2 text-xs text-red-400">{(registerMut.error as Error).message}</p>
          )}
        </section>

        {/* Apps table */}
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Registered apps
          </h2>
          {appsQ.isLoading && <p className="text-muted-foreground">Loading…</p>}
          {appsQ.data && (
            <div className="overflow-x-auto rounded-xl border border-border bg-card">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3">Slug</th>
                    <th className="px-4 py-3">Name</th>
                    <th className="px-4 py-3">App ID</th>
                    <th className="px-4 py-3">Key prefix</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Last seen</th>
                    <th className="px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {appsQ.data.apps.map((a) => (
                    <tr key={a.id} className="border-t border-border">
                      <td className="px-4 py-3 font-mono text-xs">{a.slug}</td>
                      <td className="px-4 py-3">{a.name}</td>
                      <td className="px-4 py-3 font-mono text-xs">{a.id}</td>
                      <td className="px-4 py-3 font-mono text-xs">{a.signing_key_prefix}…</td>
                      <td className="px-4 py-3">
                        <select
                          value={a.status}
                          onChange={(e) =>
                            statusMut.mutate({ id: a.id, status: e.target.value as "active" | "paused" | "revoked" })
                          }
                          className="rounded border border-border bg-background px-2 py-1 text-xs"
                        >
                          <option value="active">active</option>
                          <option value="paused">paused</option>
                          <option value="revoked">revoked</option>
                        </select>
                      </td>
                      <td className="px-4 py-3 text-xs">
                        {a.last_seen_at ? new Date(a.last_seen_at).toLocaleString() : "—"}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => {
                            if (confirm(`Rotate signing key for ${a.slug}? Old key stops working immediately.`)) {
                              rotateMut.mutate(a.id);
                            }
                          }}
                          className="rounded border border-border bg-background px-2 py-1 text-xs hover:bg-accent"
                        >
                          Rotate key
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Suggestions */}
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Suggestions (latest 200)
          </h2>
          {sugQ.data && (
            <div className="overflow-x-auto rounded-xl border border-border bg-card">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2">Updated</th>
                    <th className="px-3 py-2">Source</th>
                    <th className="px-3 py-2">App</th>
                    <th className="px-3 py-2">Title</th>
                    <th className="px-3 py-2">Target</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Broadcast</th>
                  </tr>
                </thead>
                <tbody>
                  {sugQ.data.suggestions.map((s) => (
                    <tr key={s.id} className="border-t border-border">
                      <td className="px-3 py-2 font-mono text-xs">
                        {new Date(s.updated_at).toLocaleString()}
                      </td>
                      <td className="px-3 py-2 text-xs">{s.source}</td>
                      <td className="px-3 py-2 font-mono text-xs">
                        {s.app_id?.slice(0, 8) ?? "broadcast"}
                      </td>
                      <td className="px-3 py-2 text-xs max-w-md">
                        <div className="font-medium">{s.title}</div>
                        {s.rationale && (
                          <div className="text-muted-foreground line-clamp-2">{s.rationale}</div>
                        )}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs">{s.target_key ?? "—"}</td>
                      <td className="px-3 py-2">
                        <select
                          value={s.status}
                          onChange={(e) =>
                            suggestionMut.mutate({
                              id: s.id,
                              status: e.target.value as
                                | "pending" | "approved" | "applied" | "reverted" | "rejected",
                            })
                          }
                          className="rounded border border-border bg-background px-2 py-1 text-xs"
                        >
                          <option value="pending">pending</option>
                          <option value="approved">approved</option>
                          <option value="applied">applied</option>
                          <option value="reverted">reverted</option>
                          <option value="rejected">rejected</option>
                        </select>
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          checked={!!s.broadcast}
                          onChange={(e) =>
                            suggestionMut.mutate({ id: s.id, broadcast: e.target.checked })
                          }
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Outcomes */}
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Recent outcomes
          </h2>
          {outQ.data && outQ.data.outcomes.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No outcomes yet — they appear 24h after an apply event.
            </p>
          )}
          {outQ.data && outQ.data.outcomes.length > 0 && (
            <div className="overflow-x-auto rounded-xl border border-border bg-card">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2">When</th>
                    <th className="px-3 py-2">App</th>
                    <th className="px-3 py-2">Verdict</th>
                    <th className="px-3 py-2">Baseline</th>
                    <th className="px-3 py-2">Measured</th>
                  </tr>
                </thead>
                <tbody>
                  {outQ.data.outcomes.map((o) => (
                    <tr key={o.id} className="border-t border-border align-top">
                      <td className="px-3 py-2 font-mono text-xs">
                        {new Date(o.created_at).toLocaleString()}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs">{o.app_id.slice(0, 8)}</td>
                      <td className="px-3 py-2 text-xs">{o.verdict ?? "pending"}</td>
                      <td className="px-3 py-2 font-mono text-[10px] max-w-xs whitespace-pre-wrap">
                        {JSON.stringify(o.baseline, null, 2)}
                      </td>
                      <td className="px-3 py-2 font-mono text-[10px] max-w-xs whitespace-pre-wrap">
                        {o.measured ? JSON.stringify(o.measured, null, 2) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function KeyRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-emerald-200/70">{label}</div>
      <div className="mt-1 flex items-center gap-2">
        <code className="flex-1 break-all rounded bg-background/40 px-2 py-1">{value}</code>
        <button
          onClick={() => navigator.clipboard.writeText(value)}
          className="rounded border border-emerald-500/40 px-2 py-1 text-emerald-200 hover:bg-emerald-500/20"
        >
          Copy
        </button>
      </div>
    </div>
  );
}
