import { createFileRoute, redirect } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  listCoupons,
  upsertCoupon,
  setCouponEnabled,
  deleteCoupon,
  listCouponRedemptions,
  bulkImportCoupons,
  type CouponImportOutcome,
} from "@/lib/coupons.functions";
import { describeCoupon, type CouponKind, type CouponRow } from "@/lib/coupons";
import {
  COUPON_CSV_TEMPLATE,
  MAX_COUPON_CSV_ROWS,
  parseCouponCsv,
} from "@/lib/coupon-csv";
import { BackToHubHeader } from "@/components/BackToHubHeader";
import { AppLink } from "@/components/AppLink";
import { ROUTES } from "@/lib/routes";


export const Route = createFileRoute("/admin/coupons")({
  head: () => ({
    meta: [
      { title: "Coupons — Resonance Admin" },
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
  component: AdminCouponsPage,
});

const APP_OPTIONS = ["epublisher", "creative_studio", "sync_vision", "youtube_optimizer", "all_access"];

type FormState = {
  code: string;
  kind: CouponKind;
  description: string;
  discountType: "percent" | "fixed";
  discountPercent: string;
  discountRands: string;
  creditsAmount: string;
  creditsApp: string;
  entitlementAppKey: string;
  entitlementTier: string;
  entitlementDays: string;
  appliesToApps: string;
  appliesToSkus: string;
  validUntil: string;
  maxRedemptions: string;
  maxPerUser: string;
  enabled: boolean;
};

const EMPTY: FormState = {
  code: "",
  kind: "discount",
  description: "",
  discountType: "percent",
  discountPercent: "10",
  discountRands: "",
  creditsAmount: "",
  creditsApp: "creative_studio",
  entitlementAppKey: "creative_studio",
  entitlementTier: "pro",
  entitlementDays: "30",
  appliesToApps: "",
  appliesToSkus: "",
  validUntil: "",
  maxRedemptions: "",
  maxPerUser: "1",
  enabled: true,
};

function AdminCouponsPage() {
  const listFn = useServerFn(listCoupons);
  const upsertFn = useServerFn(upsertCoupon);
  const toggleFn = useServerFn(setCouponEnabled);
  const deleteFn = useServerFn(deleteCoupon);
  const redemptionsFn = useServerFn(listCouponRedemptions);
  const importFn = useServerFn(bulkImportCoupons);
  const qc = useQueryClient();

  const [form, setForm] = useState<FormState>(EMPTY);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [openRedemptions, setOpenRedemptions] = useState<string | null>(null);

  const [csvText, setCsvText] = useState("");
  const [csvFileName, setCsvFileName] = useState<string | null>(null);
  const [updateExisting, setUpdateExisting] = useState(false);
  const [importResults, setImportResults] = useState<CouponImportOutcome[] | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  const parsed = useMemo(
    () => (csvText.trim() ? parseCouponCsv(csvText) : null),
    [csvText],
  );

  const couponsQ = useQuery({
    queryKey: ["admin-coupons"],
    queryFn: () => listFn({ data: { includeDisabled: true } }),
  });

  const redemptionsQ = useQuery({
    queryKey: ["admin-coupon-redemptions", openRedemptions],
    queryFn: () => redemptionsFn({ data: { couponId: openRedemptions, limit: 100 } }),
    enabled: !!openRedemptions,
  });

  const runImport = useMutation({
    mutationFn: async () => {
      if (!parsed || parsed.rows.length === 0) throw new Error("Nothing valid to import");
      return importFn({ data: { rows: parsed.rows, updateExisting } });
    },
    onSuccess: (res) => {
      setImportError(null);
      setImportResults(res.results);
      qc.invalidateQueries({ queryKey: ["admin-coupons"] });
    },
    onError: (e) => {
      setImportResults(null);
      setImportError((e as Error).message);
    },
  });

  async function onCsvFile(file: File | null | undefined) {
    if (!file) return;
    const text = await file.text();
    setCsvFileName(file.name);
    setImportResults(null);
    setImportError(null);
    setCsvText(text);
  }

  function downloadTemplate() {
    const blob = new Blob([`${COUPON_CSV_TEMPLATE}\n`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "coupon-import-template.csv";
    a.click();
    URL.revokeObjectURL(url);
  }


  const save = useMutation({
    mutationFn: async () => {
      const rands = Number(form.discountRands);
      return upsertFn({
        data: {
          id: editingId,
          code: form.code,
          kind: form.kind,
          description: form.description || null,
          discountType: form.kind === "discount" ? form.discountType : null,
          discountPercent:
            form.kind === "discount" && form.discountType === "percent"
              ? Number(form.discountPercent)
              : null,
          discountCents:
            form.kind === "discount" && form.discountType === "fixed" && rands > 0
              ? Math.round(rands * 100)
              : null,
          creditsAmount: form.kind === "credits" ? Number(form.creditsAmount) : null,
          creditsApp: form.kind === "credits" ? form.creditsApp : null,
          entitlementAppKey: form.kind === "entitlement" ? form.entitlementAppKey : null,
          entitlementTier: form.kind === "entitlement" ? form.entitlementTier : null,
          entitlementDays:
            form.kind === "entitlement" && form.entitlementDays
              ? Number(form.entitlementDays)
              : null,
          appliesToApps: form.appliesToApps
            .split(",")
            .map((v) => v.trim())
            .filter(Boolean),
          appliesToSkus: form.appliesToSkus
            .split(",")
            .map((v) => v.trim())
            .filter(Boolean),
          validUntil: form.validUntil ? new Date(form.validUntil).toISOString() : null,
          maxRedemptions: form.maxRedemptions ? Number(form.maxRedemptions) : null,
          maxPerUser: Number(form.maxPerUser) || 1,
          enabled: form.enabled,
        },
      });
    },
    onSuccess: () => {
      setForm(EMPTY);
      setEditingId(null);
      setFormError(null);
      qc.invalidateQueries({ queryKey: ["admin-coupons"] });
    },
    onError: (e) => setFormError((e as Error).message),
  });

  const toggle = useMutation({
    mutationFn: (v: { id: string; enabled: boolean }) => toggleFn({ data: v }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-coupons"] }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-coupons"] }),
    onError: (e) => setFormError((e as Error).message),
  });

  function startEdit(c: CouponRow) {
    setEditingId(c.id);
    setFormError(null);
    setForm({
      code: c.code,
      kind: c.kind,
      description: c.description ?? "",
      discountType: c.discount_type ?? "percent",
      discountPercent: String(c.discount_percent ?? 10),
      discountRands: c.discount_cents ? String(c.discount_cents / 100) : "",
      creditsAmount: String(c.credits_amount ?? ""),
      creditsApp: c.credits_app ?? "creative_studio",
      entitlementAppKey: c.entitlement_app_key ?? "creative_studio",
      entitlementTier: c.entitlement_tier ?? "pro",
      entitlementDays: String(c.entitlement_days ?? ""),
      appliesToApps: c.applies_to_apps.join(", "),
      appliesToSkus: c.applies_to_skus.join(", "),
      validUntil: c.valid_until ? c.valid_until.slice(0, 10) : "",
      maxRedemptions: c.max_redemptions ? String(c.max_redemptions) : "",
      maxPerUser: String(c.max_per_user),
      enabled: c.enabled,
    });
  }

  const field = "w-full rounded-lg border bg-background px-3 py-2 text-sm";
  const labelCls = "block text-xs uppercase tracking-wide text-muted-foreground mb-1";

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-6xl mx-auto px-4 py-10 space-y-8">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold">Coupons</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Checkout discounts, free credit grants, and free access codes. Every
              redemption is recorded against the user and, for paid checkouts, the
              PayFast payment id.
            </p>
          </div>
          <BackToHubHeader
            extra={
              <>
                <AppLink to={ROUTES.adminCredits} className="text-primary underline">
                  Credits
                </AppLink>
                <AppLink to={ROUTES.adminBilling} className="text-primary underline">
                  Billing
                </AppLink>
              </>
            }
          />
        </header>

        <section className="rounded-lg border bg-card p-5 space-y-4">
          <h2 className="font-bold">{editingId ? "Edit coupon" : "New coupon"}</h2>
          <div className="grid gap-4 md:grid-cols-3">
            <div>
              <label className={labelCls} htmlFor="c-code">Code</label>
              <input
                id="c-code"
                className={`${field} font-mono uppercase`}
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
                maxLength={64}
              />
            </div>
            <div>
              <label className={labelCls} htmlFor="c-kind">Kind</label>
              <select
                id="c-kind"
                className={field}
                value={form.kind}
                onChange={(e) => setForm({ ...form, kind: e.target.value as CouponKind })}
              >
                <option value="discount">Checkout discount</option>
                <option value="credits">Free credits</option>
                <option value="entitlement">Free access (tier)</option>
              </select>
            </div>
            <div>
              <label className={labelCls} htmlFor="c-desc">Description</label>
              <input
                id="c-desc"
                className={field}
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                maxLength={500}
              />
            </div>

            {form.kind === "discount" && (
              <>
                <div>
                  <label className={labelCls} htmlFor="c-dtype">Discount type</label>
                  <select
                    id="c-dtype"
                    className={field}
                    value={form.discountType}
                    onChange={(e) =>
                      setForm({ ...form, discountType: e.target.value as "percent" | "fixed" })
                    }
                  >
                    <option value="percent">Percent off</option>
                    <option value="fixed">Rand amount off</option>
                  </select>
                </div>
                {form.discountType === "percent" ? (
                  <div>
                    <label className={labelCls} htmlFor="c-pct">Percent (1–100)</label>
                    <input
                      id="c-pct"
                      type="number"
                      min={1}
                      max={100}
                      className={field}
                      value={form.discountPercent}
                      onChange={(e) => setForm({ ...form, discountPercent: e.target.value })}
                    />
                  </div>
                ) : (
                  <div>
                    <label className={labelCls} htmlFor="c-rands">Rands off</label>
                    <input
                      id="c-rands"
                      type="number"
                      min={1}
                      className={field}
                      value={form.discountRands}
                      onChange={(e) => setForm({ ...form, discountRands: e.target.value })}
                    />
                  </div>
                )}
              </>
            )}

            {form.kind === "credits" && (
              <>
                <div>
                  <label className={labelCls} htmlFor="c-credits">Credits</label>
                  <input
                    id="c-credits"
                    type="number"
                    min={1}
                    className={field}
                    value={form.creditsAmount}
                    onChange={(e) => setForm({ ...form, creditsAmount: e.target.value })}
                  />
                </div>
                <div>
                  <label className={labelCls} htmlFor="c-capp">Credit wallet app</label>
                  <select
                    id="c-capp"
                    className={field}
                    value={form.creditsApp}
                    onChange={(e) => setForm({ ...form, creditsApp: e.target.value })}
                  >
                    {APP_OPTIONS.map((a) => (
                      <option key={a} value={a}>{a.replace(/_/g, " ")}</option>
                    ))}
                  </select>
                </div>
              </>
            )}

            {form.kind === "entitlement" && (
              <>
                <div>
                  <label className={labelCls} htmlFor="c-eapp">App key</label>
                  <select
                    id="c-eapp"
                    className={field}
                    value={form.entitlementAppKey}
                    onChange={(e) => setForm({ ...form, entitlementAppKey: e.target.value })}
                  >
                    {APP_OPTIONS.map((a) => (
                      <option key={a} value={a}>{a.replace(/_/g, " ")}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={labelCls} htmlFor="c-etier">Tier</label>
                  <input
                    id="c-etier"
                    className={field}
                    value={form.entitlementTier}
                    onChange={(e) => setForm({ ...form, entitlementTier: e.target.value })}
                  />
                </div>
                <div>
                  <label className={labelCls} htmlFor="c-edays">Days (blank = no expiry)</label>
                  <input
                    id="c-edays"
                    type="number"
                    min={1}
                    className={field}
                    value={form.entitlementDays}
                    onChange={(e) => setForm({ ...form, entitlementDays: e.target.value })}
                  />
                </div>
              </>
            )}

            <div>
              <label className={labelCls} htmlFor="c-apps">Restrict to apps (comma separated)</label>
              <input
                id="c-apps"
                className={field}
                placeholder="all apps"
                value={form.appliesToApps}
                onChange={(e) => setForm({ ...form, appliesToApps: e.target.value })}
              />
            </div>
            <div>
              <label className={labelCls} htmlFor="c-skus">Restrict to SKUs (comma separated)</label>
              <input
                id="c-skus"
                className={field}
                placeholder="all SKUs"
                value={form.appliesToSkus}
                onChange={(e) => setForm({ ...form, appliesToSkus: e.target.value })}
              />
            </div>
            <div>
              <label className={labelCls} htmlFor="c-until">Expires (date)</label>
              <input
                id="c-until"
                type="date"
                className={field}
                value={form.validUntil}
                onChange={(e) => setForm({ ...form, validUntil: e.target.value })}
              />
            </div>
            <div>
              <label className={labelCls} htmlFor="c-max">Max total uses (blank = unlimited)</label>
              <input
                id="c-max"
                type="number"
                min={1}
                className={field}
                value={form.maxRedemptions}
                onChange={(e) => setForm({ ...form, maxRedemptions: e.target.value })}
              />
            </div>
            <div>
              <label className={labelCls} htmlFor="c-peruser">Max per user</label>
              <input
                id="c-peruser"
                type="number"
                min={1}
                className={field}
                value={form.maxPerUser}
                onChange={(e) => setForm({ ...form, maxPerUser: e.target.value })}
              />
            </div>
            <label className="flex items-center gap-2 text-sm mt-6">
              <input
                type="checkbox"
                checked={form.enabled}
                onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
              />
              Enabled
            </label>
          </div>

          {formError && (
            <p className="text-sm text-destructive" role="alert">{formError}</p>
          )}

          <div className="flex gap-3">
            <button
              onClick={() => save.mutate()}
              disabled={save.isPending || !form.code.trim()}
              className="px-5 py-2.5 rounded-full bg-primary-surface text-primary-foreground font-bold text-sm disabled:opacity-60"
            >
              {save.isPending ? "Saving…" : editingId ? "Save changes" : "Create coupon"}
            </button>
            {editingId && (
              <button
                onClick={() => {
                  setEditingId(null);
                  setForm(EMPTY);
                  setFormError(null);
                }}
                className="px-5 py-2.5 rounded-full border text-sm"
              >
                Cancel
              </button>
            )}
          </div>
        </section>

        <section className="rounded-lg border bg-card p-5">
          <h2 className="font-bold mb-4">All coupons</h2>
          {couponsQ.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : couponsQ.error ? (
            <p className="text-sm text-destructive">{(couponsQ.error as Error).message}</p>
          ) : (couponsQ.data?.coupons.length ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground">No coupons yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs uppercase tracking-wide text-muted-foreground">
                  <tr className="border-b">
                    <th className="text-left py-2">Code</th>
                    <th className="text-left py-2">Effect</th>
                    <th className="text-left py-2">Scope</th>
                    <th className="text-left py-2">Used</th>
                    <th className="text-left py-2">Expires</th>
                    <th className="text-left py-2">Status</th>
                    <th className="text-right py-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {couponsQ.data!.coupons.map((c) => (
                    <tr key={c.id} className="border-b last:border-0 align-top">
                      <td className="py-2 font-mono">{c.code}</td>
                      <td className="py-2">{describeCoupon(c)}</td>
                      <td className="py-2 text-xs text-muted-foreground">
                        {c.applies_to_apps.length ? c.applies_to_apps.join(", ") : "all apps"}
                        {c.applies_to_skus.length ? ` · ${c.applies_to_skus.join(", ")}` : ""}
                      </td>
                      <td className="py-2">
                        {c.redemption_count}
                        {c.max_redemptions ? ` / ${c.max_redemptions}` : ""}
                      </td>
                      <td className="py-2">
                        {c.valid_until ? new Date(c.valid_until).toLocaleDateString() : "—"}
                      </td>
                      <td className="py-2">
                        <span className={c.enabled ? "text-emerald-500" : "text-muted-foreground"}>
                          {c.enabled ? "Active" : "Disabled"}
                        </span>
                      </td>
                      <td className="py-2 text-right space-x-3 whitespace-nowrap">
                        <button className="underline text-xs" onClick={() => startEdit(c)}>Edit</button>
                        <button
                          className="underline text-xs"
                          onClick={() => toggle.mutate({ id: c.id, enabled: !c.enabled })}
                        >
                          {c.enabled ? "Disable" : "Enable"}
                        </button>
                        <button
                          className="underline text-xs"
                          onClick={() => setOpenRedemptions(openRedemptions === c.id ? null : c.id)}
                        >
                          Redemptions
                        </button>
                        <button
                          className="underline text-xs text-destructive"
                          onClick={() => remove.mutate(c.id)}
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {openRedemptions && (
          <section className="rounded-lg border bg-card p-5">
            <h2 className="font-bold mb-4">Redemptions</h2>
            {redemptionsQ.isLoading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : (redemptionsQ.data?.redemptions.length ?? 0) === 0 ? (
              <p className="text-sm text-muted-foreground">No redemptions for this coupon yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-xs uppercase tracking-wide text-muted-foreground">
                    <tr className="border-b">
                      <th className="text-left py-2">When</th>
                      <th className="text-left py-2">User</th>
                      <th className="text-left py-2">Kind</th>
                      <th className="text-left py-2">Detail</th>
                      <th className="text-left py-2">PayFast ref</th>
                    </tr>
                  </thead>
                  <tbody>
                    {redemptionsQ.data!.redemptions.map((r) => (
                      <tr key={r.id} className="border-b last:border-0">
                        <td className="py-2">{new Date(r.created_at).toLocaleString()}</td>
                        <td className="py-2 font-mono text-xs">{r.user_id}</td>
                        <td className="py-2">{r.kind}</td>
                        <td className="py-2">
                          {r.kind === "discount"
                            ? `−R${((r.discount_cents_applied ?? 0) / 100).toFixed(2)} → R${((r.final_amount_cents ?? 0) / 100).toFixed(2)}`
                            : r.kind === "credits"
                              ? `${(r.credits_granted ?? 0).toLocaleString()} credits`
                              : (r.entitlement_id ?? "entitlement granted")}
                        </td>
                        <td className="py-2 font-mono text-xs">{r.m_payment_id ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
