import { createFileRoute, redirect, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  addPromotionContact,
  exportPromotionCsv,
  getPromotionPreflight,
  importPromotionCsv,
  listPromotionContacts,
  setPromotionContactStatus,
} from "@/lib/promotion.functions";

export const Route = createFileRoute("/admin/promotion")({
  head: () => ({
    meta: [
      { title: "Promotion Contacts - Resonance Admin" },
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
  component: PromotionAdmin,
});

const baseForm = {
  name: "",
  organisation: "",
  website: "",
  email: "",
  contact_type: "business",
  source: "manual",
  consent_basis: "",
  opted_in: false,
  segment: "general",
  status: "active" as const,
  notes: "",
};
function PromotionAdmin() {
  const qc = useQueryClient(),
    list = useServerFn(listPromotionContacts),
    add = useServerFn(addPromotionContact),
    setStatus = useServerFn(setPromotionContactStatus);
  const importCsv = useServerFn(importPromotionCsv),
    exportCsv = useServerFn(exportPromotionCsv),
    preflight = useServerFn(getPromotionPreflight);
  const q = useQuery({ queryKey: ["promotion-contacts"], queryFn: () => list() });
  const [form, setForm] = useState(baseForm);
  const [segment, setSegment] = useState("all");
  const segments = useMemo(
    () => [
      "all",
      ...Array.from(new Set((q.data?.contacts ?? []).map((c) => String(c.segment || "general")))),
    ],
    [q.data],
  );
  const addMut = useMutation({
    mutationFn: () => add({ data: form }),
    onSuccess: () => {
      setForm(baseForm);
      qc.invalidateQueries({ queryKey: ["promotion-contacts"] });
    },
  });
  const statusMut = useMutation({
    mutationFn: (v: { id: string; status: "active" | "suppressed" | "unsubscribed" }) =>
      setStatus({ data: { ...v, reason: "admin promotion workspace" } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["promotion-contacts"] }),
  });
  const preflightMut = useMutation({ mutationFn: () => preflight({ data: { segment } }) });
  const importMut = useMutation({
    mutationFn: (csv: string) => importCsv({ data: { csv, default_segment: "general" } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["promotion-contacts"] }),
  });
  const exportMut = useMutation({
    mutationFn: () => exportCsv(),
    onSuccess: (r) => {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([r.csv], { type: "text/csv" }));
      a.download = r.filename;
      a.click();
      URL.revokeObjectURL(a.href);
    },
  });
  const visible = (q.data?.contacts ?? []).filter(
    (c) => segment === "all" || String(c.segment || "general") === segment,
  );
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-7xl px-6 py-12 space-y-8">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">
              Resonance Admin
            </p>
            <h1 className="mt-2 text-3xl font-semibold">Promotion Contacts</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Local-first contact governance, segmentation and campaign preflight. No automatic
              sending authority.
            </p>
          </div>
          <div className="flex gap-2">
            <Link
              to="/admin/control-center"
              className="rounded border border-border px-3 py-2 text-sm"
            >
              Control Center
            </Link>
            <Link to="/admin/emails" className="rounded border border-border px-3 py-2 text-sm">
              Email Delivery
            </Link>
          </div>
        </header>
        <section className="grid md:grid-cols-4 gap-3">
          <Card label="Records" value={String(q.data?.contacts.length ?? 0)} />
          <Card label="Eligible" value={String(q.data?.eligible_count ?? 0)} />
          <Card label="Segment" value={segment} />
          <Card label="Send authority" value="OFF" />
        </section>
        <section className="rounded-xl border border-border bg-card p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-semibold">CSV & campaign controls</h2>
              <p className="text-sm text-muted-foreground">
                Imports dedupe by normalized email. Preflight excludes suppressed, unsubscribed and
                contacts without recorded permission.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <select
                value={segment}
                onChange={(e) => setSegment(e.target.value)}
                className="rounded border border-border bg-background px-3 py-2 text-sm"
              >
                {segments.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
              <button
                onClick={() => preflightMut.mutate()}
                className="rounded border border-border px-3 py-2 text-sm"
              >
                Run preflight
              </button>
              <button
                onClick={() => exportMut.mutate()}
                className="rounded border border-border px-3 py-2 text-sm"
              >
                Export CSV
              </button>
              <label className="rounded border border-border px-3 py-2 text-sm cursor-pointer">
                Import CSV
                <input
                  type="file"
                  accept=".csv,text/csv"
                  className="hidden"
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    if (f) importMut.mutate(await f.text());
                    e.currentTarget.value = "";
                  }}
                />
              </label>
            </div>
          </div>
          {preflightMut.data && (
            <div className="mt-4 grid sm:grid-cols-3 lg:grid-cols-6 gap-2 text-sm">
              <Mini label="Eligible" value={String(preflightMut.data.eligible)} />
              <Mini label="Excluded" value={String(preflightMut.data.excluded)} />
              <Mini label="Suppressed" value={String(preflightMut.data.suppressed)} />
              <Mini label="Unsubscribed" value={String(preflightMut.data.unsubscribed)} />
              <Mini label="No consent" value={String(preflightMut.data.no_consent)} />
              <Mini
                label="Est. cost"
                value={
                  preflightMut.data.estimated_cost_usd == null
                    ? "Not configured"
                    : `$${Number(preflightMut.data.estimated_cost_usd).toFixed(4)}`
                }
              />
            </div>
          )}
          {importMut.data && (
            <p className="mt-3 text-sm text-emerald-400">
              Imported {importMut.data.added}; skipped {importMut.data.skipped} duplicate/invalid
              rows.
            </p>
          )}
          {(importMut.error || exportMut.error || preflightMut.error) && (
            <p className="mt-3 text-sm text-red-400">
              {String((importMut.error || exportMut.error || preflightMut.error) as Error)}
            </p>
          )}
        </section>
        <section className="rounded-xl border border-border bg-card p-5">
          <h2 className="font-semibold">Add verified contact</h2>
          <div className="mt-4 grid md:grid-cols-2 gap-3">
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Name"
              className="rounded border border-border bg-background px-3 py-2"
            />
            <input
              value={form.organisation}
              onChange={(e) => setForm({ ...form, organisation: e.target.value })}
              placeholder="Organisation"
              className="rounded border border-border bg-background px-3 py-2"
            />
            <input
              value={form.website}
              onChange={(e) => setForm({ ...form, website: e.target.value })}
              placeholder="Website / address"
              className="rounded border border-border bg-background px-3 py-2"
            />
            <input
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              placeholder="Email"
              className="rounded border border-border bg-background px-3 py-2"
            />
            <input
              value={form.source}
              onChange={(e) => setForm({ ...form, source: e.target.value })}
              placeholder="Source / provenance"
              className="rounded border border-border bg-background px-3 py-2"
            />
            <input
              value={form.consent_basis}
              onChange={(e) => setForm({ ...form, consent_basis: e.target.value })}
              placeholder="Consent basis"
              className="rounded border border-border bg-background px-3 py-2"
            />
            <input
              value={form.segment}
              onChange={(e) => setForm({ ...form, segment: e.target.value })}
              placeholder="Segment"
              className="rounded border border-border bg-background px-3 py-2"
            />
            <input
              value={form.contact_type}
              onChange={(e) => setForm({ ...form, contact_type: e.target.value })}
              placeholder="Contact type"
              className="rounded border border-border bg-background px-3 py-2"
            />
          </div>
          <label className="mt-3 flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.opted_in}
              onChange={(e) => setForm({ ...form, opted_in: e.target.checked })}
            />
            Permission / opt-in recorded
          </label>
          <textarea
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            placeholder="Notes"
            className="mt-3 min-h-20 w-full rounded border border-border bg-background p-3"
          />
          <button
            onClick={() => addMut.mutate()}
            disabled={!form.email || addMut.isPending}
            className="mt-3 rounded bg-primary px-4 py-2 text-primary-foreground disabled:opacity-50"
          >
            Add contact
          </button>
          {addMut.error && (
            <p className="mt-2 text-sm text-red-400">{(addMut.error as Error).message}</p>
          )}
        </section>
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold">Contacts</h2>
            <span className="text-xs text-muted-foreground">{visible.length} shown</span>
          </div>
          <div className="overflow-x-auto rounded-xl border border-border bg-card">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="p-3">Name</th>
                  <th className="p-3">Organisation</th>
                  <th className="p-3">Email</th>
                  <th className="p-3">Segment</th>
                  <th className="p-3">Consent</th>
                  <th className="p-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((c) => (
                  <tr key={c.id} className="border-t border-border">
                    <td className="p-3">{c.name || "-"}</td>
                    <td className="p-3">{c.organisation || "-"}</td>
                    <td className="p-3 font-mono text-xs">{c.email}</td>
                    <td className="p-3">{c.segment || "general"}</td>
                    <td className="p-3">
                      {c.opted_in && c.consent_basis ? "recorded" : "not eligible"}
                    </td>
                    <td className="p-3">
                      <select
                        value={c.status}
                        onChange={(e) =>
                          statusMut.mutate({
                            id: c.id,
                            status: e.target.value as "active" | "suppressed" | "unsubscribed",
                          })
                        }
                        className="rounded border border-border bg-background px-2 py-1 text-xs"
                      >
                        <option value="active">active</option>
                        <option value="suppressed">suppressed</option>
                        <option value="unsubscribed">unsubscribed</option>
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <p className="text-xs text-muted-foreground">
          RCGF guardrail: importing, exporting, segmenting and preflighting contacts never sends
          email. Delivery remains a distinct human-approved action.
        </p>
      </div>
    </div>
  );
}
function Card({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="text-xs uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-2 text-xl font-semibold">{value}</p>
    </div>
  );
}
function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded bg-background p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-semibold">{value}</p>
    </div>
  );
}
