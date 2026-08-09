import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { redeemCoupon, type RedeemResult } from "@/lib/coupons.functions";
import { couponReasonMessage } from "@/lib/coupons";
import { BackToHubHeader } from "@/components/BackToHubHeader";
import { AppLink } from "@/components/AppLink";
import { ROUTES } from "@/lib/routes";

export const Route = createFileRoute("/redeem")({
  head: () => ({
    meta: [
      { title: "Redeem a code — The Resonance Hub" },
      {
        name: "description",
        content:
          "Redeem a Resonance credit or access code to add credits to your app wallet or unlock an app tier instantly.",
      },
      { property: "og:title", content: "Redeem a code — The Resonance Hub" },
      {
        property: "og:description",
        content: "Enter a Resonance coupon code to claim credits or app access.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: RedeemPage,
});

function RedeemPage() {
  const redeem = useServerFn(redeemCoupon);
  const [authReady, setAuthReady] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<RedeemResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSignedIn(!!data.session?.user);
      setAuthReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setSignedIn(!!session?.user);
    });
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = code.trim();
    if (!trimmed) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await redeem({ data: { code: trimmed } });
      setResult(res);
      if (res.ok) setCode("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-xl mx-auto px-4 py-12 space-y-8">
        <BackToHubHeader
          extra={
            <AppLink to={ROUTES.pricing} className="text-primary underline">
              Pricing
            </AppLink>
          }
        />

        <header>
          <p className="text-[10px] font-mono uppercase tracking-[0.25em] text-muted-foreground mb-2">
            Coupons · credits · access
          </p>
          <h1 className="text-3xl font-bold">Redeem a code</h1>
          <p className="text-sm text-muted-foreground mt-2">
            Codes that grant credits or app access are claimed here. Percentage or
            rand-value discount codes are entered at{" "}
            <AppLink to={ROUTES.checkout} className="text-primary underline">
              checkout
            </AppLink>{" "}
            instead.
          </p>
        </header>

        {!authReady ? (
          <p className="text-muted-foreground text-sm">Loading…</p>
        ) : !signedIn ? (
          <div className="rounded-xl border bg-card p-5 space-y-3">
            <p className="text-sm">Sign in to redeem a code against your account.</p>
            <AppLink
              to={ROUTES.login}
              search={{ next: ROUTES.redeem }}
              className="inline-block px-5 py-2.5 rounded-full bg-primary-surface text-primary-foreground font-bold text-sm"
            >
              Sign in
            </AppLink>
          </div>
        ) : (
          <form onSubmit={submit} className="rounded-xl border bg-card p-5 space-y-4">
            <div>
              <label
                htmlFor="redeem-code"
                className="block text-xs uppercase tracking-wide text-muted-foreground mb-1"
              >
                Your code
              </label>
              <input
                id="redeem-code"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                maxLength={64}
                autoComplete="off"
                spellCheck={false}
                placeholder="WELCOME500"
                className="w-full rounded-lg border bg-background px-3 py-2 font-mono tracking-wider"
              />
            </div>
            <button
              type="submit"
              disabled={busy || !code.trim()}
              className="w-full px-6 py-3 rounded-full bg-primary-surface text-primary-foreground font-bold text-sm disabled:opacity-60"
            >
              {busy ? "Redeeming…" : "Redeem code"}
            </button>
          </form>
        )}

        {error && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm">
            {error}
          </div>
        )}

        {result && !result.ok && (
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm" role="status">
            {couponReasonMessage(result.reason)}
          </div>
        )}

        {result?.ok && (
          <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-4 text-sm space-y-2" role="status">
            <p className="font-bold">Code redeemed.</p>
            {result.kind === "credits" ? (
              <p>
                {(result.creditsGranted ?? 0).toLocaleString()} credits added to your{" "}
                {(result.creditsApp ?? "").replace(/_/g, " ")} wallet.
              </p>
            ) : (
              <p>
                {result.entitlementTier} access unlocked on{" "}
                {(result.entitlementAppKey ?? "").replace(/_/g, " ")}.
              </p>
            )}
            <AppLink to={ROUTES.accountSubscriptions} className="text-primary underline">
              View my access →
            </AppLink>
          </div>
        )}
      </div>
    </div>
  );
}
