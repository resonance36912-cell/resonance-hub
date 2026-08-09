import { useEffect, useRef, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import {
  SKU_CATALOG,
  PACK_CATALOG,
  createPayfastLaunch,
  resolveSku,
  type PayfastLaunch,
  type PackDef,
  type SkuDef,
} from "@/lib/checkout.functions";
import resonanceLockup from "@/assets/resonance-lockup.png";
import { previewCoupon } from "@/lib/coupons.functions";
import { couponReasonMessage, type CouponPreview } from "@/lib/coupons";
import { ROUTES } from "@/lib/routes";
import { AppLink } from "@/components/AppLink";

const SearchSchema = z.object({
  app: z.string().optional(),
  plan: z.string().optional(),
  sku: z.string().optional(),
  pack: z.string().optional(),
  cycle: z.literal("monthly").optional(),
  return_to: z.string().url().optional(),
});

type Search = z.infer<typeof SearchSchema>;

export const Route = createFileRoute("/checkout/")({
  head: () => ({
    meta: [
      { title: "Checkout — The Resonance Hub" },
      { name: "description", content: "Secure Hub checkout for Resonance app packs and ecosystem passes via PayFast." },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  validateSearch: (raw: Record<string, unknown>): Search => SearchSchema.parse(raw),
  component: CheckoutPage,
});

function resolveFromSearch(s: Search): SkuDef | null {
  if (s.sku && SKU_CATALOG[s.sku]) return SKU_CATALOG[s.sku];
  if (s.app && s.plan) return resolveSku(s.app, s.plan, s.cycle ?? "monthly");
  return null;
}


function CheckoutPage() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  const pack: PackDef | null = search.pack ? PACK_CATALOG[search.pack] ?? null : null;
  const def = pack ? null : resolveFromSearch(search);

  const [authReady, setAuthReady] = useState(false);
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setEmail(data.session?.user?.email ?? null);
      setAuthReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setEmail(session?.user?.email ?? null);
    });
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  // Once-off pack: same PayFast flow as monthly, resolved via pack.sku.
  if (pack) {
    return (
      <Shell>
        <div className="mb-6">
          <p className="text-[10px] font-mono uppercase tracking-[0.25em] text-white/55 mb-2">
            Checkout · Once-off pack · ZAR · PayFast
          </p>
          <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight">{pack.name}</h1>
          <p className="text-white/65 mt-2">
            {pack.zar} · once-off · {pack.creditsGranted.toLocaleString()} credits into your {pack.app.replace(/_/g, " ")} wallet
          </p>
        </div>

        <div className="mb-6 rounded-xl border border-white/10 bg-white/[0.03] p-4 text-sm space-y-2">
          <Row label="Purchase type" value="Once-off pack (no subscription)" />
          <Row label="App" value={pack.app.replace(/_/g, " ")} />
          <Row label="Price" value={`${pack.zar} once-off`} />
          <Row label="Credits granted" value={`${pack.creditsGranted.toLocaleString()} credits`} />
          <Row label="Includes" value={pack.includes.join(" · ")} />
        </div>

        {!authReady ? (
          <p className="text-white/60">Loading…</p>
        ) : email ? (
          <PayBlock sku={pack.sku} email={email} returnTo={search.return_to} />
        ) : (
          <AuthBlock onSignedIn={() => {}} />
        )}

        <div className="mt-6">
          <AppLink
            to={ROUTES.pricing}
            className="text-xs text-white/60 hover:text-white underline"
          >
            ← Back to packs
          </AppLink>
        </div>
      </Shell>
    );
  }


  if (!def) {
    return (
      <Shell>
        <h1 className="text-2xl font-bold mb-3">Plan not found</h1>
        <p className="text-white/70 mb-6">
          We couldn&apos;t match that plan. Pick one from the pricing page.
        </p>
        <AppLink
          to={ROUTES.pricing}
          className="inline-block px-5 py-2.5 rounded-full bg-gradient-brand text-white font-bold text-sm"
        >
          View pricing
        </AppLink>
      </Shell>
    );
  }

  const isLegacy = def.kind === "legacy_monthly";
  const purchaseType = def.kind === "pass" ? "Monthly ecosystem pass" : "Legacy monthly plan";

  return (
    <Shell>
      <div className="mb-8">
        <p className="text-[10px] font-mono uppercase tracking-[0.25em] text-white/55 mb-2">
          Checkout · {purchaseType} · ZAR · PayFast
        </p>
        <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight">
          {def.label}
        </h1>
        <p className="text-white/65 mt-2">
          R{(def.amountCents / 100).toFixed(2)} / {def.cycle}
        </p>
        {isLegacy && (
          <div className="mt-4 rounded-xl border border-white/15 bg-white/[0.04] p-3 text-xs text-white/70 leading-relaxed">
            This is a retired per-app monthly plan. New signups should choose an ecosystem pass or
            a once-off pack from the{" "}
            <AppLink to={ROUTES.pricing} className="underline hover:text-white">
              pricing page
            </AppLink>
            . Existing subscribers can continue renewing here.
          </div>
        )}
      </div>

      {!authReady ? (
        <p className="text-white/60">Loading…</p>
      ) : email ? (
        <PayBlock sku={def.sku} email={email} returnTo={search.return_to} />
      ) : (
        <AuthBlock
          onSignedIn={() => {
            // session listener will refresh email
          }}
        />
      )}

      <p className="mt-8 text-[11px] text-white/65">
        You&apos;ll be redirected to PayFast to complete payment securely. Cancel anytime from
        your account.
      </p>

      <div className="mt-6">
        <button
          onClick={() => navigate({ to: ROUTES.pricing })}
          className="text-xs text-white/60 hover:text-white underline"
        >
          ← Back to pricing
        </button>
      </div>
    </Shell>
  );
}


function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen text-foreground">
      <nav className="fixed top-0 w-full z-50 px-6 py-4 flex justify-between items-center backdrop-blur-xl bg-background/60 border-b border-white/5">
        <AppLink to={ROUTES.home} className="flex items-center gap-2.5 min-w-0">
          <img src={resonanceLockup} alt="The Resonance" className="h-6 sm:h-7 w-auto brightness-0 invert" />
        </AppLink>
        <AppLink
          to={ROUTES.home}
          className="text-[11px] font-bold tracking-[0.15em] uppercase px-4 py-2 rounded-full border border-white/15 hover:border-white/40 transition-colors"
        >
          ← Back to Hub
        </AppLink>
      </nav>
      <main className="pt-28 pb-24 px-6 max-w-xl mx-auto">
        <div className="rounded-3xl border border-white/10 bg-card/60 backdrop-blur-xl p-8">
          {children}
        </div>
      </main>
    </div>
  );
}

function PayBlock({ sku, email, returnTo }: { sku: string; email: string; returnTo?: string }) {
  const launch = useServerFn(createPayfastLaunch);
  const preview = useServerFn(previewCoupon);
  const [couponInput, setCouponInput] = useState("");
  const [coupon, setCoupon] = useState<CouponPreview | null>(null);
  const [couponMsg, setCouponMsg] = useState<string | null>(null);
  const [couponBusy, setCouponBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [payload, setPayload] = useState<PayfastLaunch | null>(null);
  const [slow, setSlow] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const def = SKU_CATALOG[sku];

  useEffect(() => {
    if (payload && formRef.current) formRef.current.submit();
  }, [payload]);

  // Surface a "still working" fallback if the launch hasn't returned in 5s.
  useEffect(() => {
    if (!loading) {
      setSlow(false);
      return;
    }
    const t = setTimeout(() => setSlow(true), 5000);
    return () => clearTimeout(t);
  }, [loading]);

  async function applyCoupon() {
    const code = couponInput.trim();
    if (!code) return;
    setCouponBusy(true);
    setCouponMsg(null);
    try {
      const res = await preview({ data: { code, sku } });
      if (res.valid && res.kind === "discount") {
        setCoupon(res);
        setCouponMsg(couponReasonMessage("ok"));
      } else {
        setCoupon(null);
        setCouponMsg(
          couponReasonMessage(res.valid ? "not_a_checkout_coupon" : res.reason || "unknown_code"),
        );
      }
    } catch (e) {
      setCoupon(null);
      setCouponMsg((e as Error).message);
    } finally {
      setCouponBusy(false);
    }
  }

  function clearCoupon() {
    setCoupon(null);
    setCouponMsg(null);
    setCouponInput("");
  }

  async function start() {
    setLoading(true);
    setError(null);
    try {
      const res = await launch({
        data: { sku, returnTo, ...(coupon?.code ? { couponCode: coupon.code } : {}) },
      });
      setPayload(res);
    } catch (e) {
      setError((e as Error).message);
      setLoading(false);
    }
  }

  return (
    <div>
      {/* Preflight panel — what is actually about to happen */}
      <div className="mb-6 rounded-xl border border-white/10 bg-white/[0.03] p-4 text-sm space-y-2">
        <Row label="Plan" value={def?.label ?? sku} />
        <Row
          label="Price"
          value={def ? `R${(def.amountCents / 100).toFixed(2)}${def.cycle === "monthly" ? " / month" : " once-off"}` : "—"}
        />
        <Row label="Billing" value={def?.cycle === "once" ? "One-time payment" : "Monthly · cancel anytime"} />

        {coupon?.code && (
          <>
            <Row label="Coupon" value={coupon.code} />
            <Row
              label="Discount"
              value={`− R${(coupon.discount_cents_applied / 100).toFixed(2)}`}
            />
            <Row
              label="You pay"
              value={`R${(coupon.final_amount_cents / 100).toFixed(2)}`}
            />
          </>
        )}
        <Row label="Account" value={email} />
        {returnTo && <Row label="Returns to" value={new URL(returnTo).host} />}
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300 space-y-2">
          <div>{error}</div>
          <div className="flex gap-2 pt-1">
            <button onClick={start} className="text-xs underline">
              Retry
            </button>
            <AppLink to={ROUTES.pricing} className="text-xs underline">
              Back to pricing
            </AppLink>
            <AppLink to={ROUTES.home} className="text-xs underline">
              Back to Hub
            </AppLink>
          </div>
        </div>
      )}

      {/* Coupon code */}
      <div className="mb-5 rounded-xl border border-white/10 bg-white/[0.02] p-4">
        <label htmlFor="coupon-code" className="block text-[11px] uppercase tracking-[0.18em] text-white/55 mb-2">
          Coupon code (optional)
        </label>
        <div className="flex gap-2">
          <input
            id="coupon-code"
            value={couponInput}
            onChange={(e) => setCouponInput(e.target.value.toUpperCase())}
            maxLength={64}
            autoComplete="off"
            spellCheck={false}
            placeholder="RESONANCE20"
            disabled={!!coupon || loading || !!payload}
            className="flex-1 rounded-lg border border-white/15 bg-background/60 px-3 py-2 text-sm font-mono tracking-wider disabled:opacity-60"
          />
          {coupon ? (
            <button
              type="button"
              onClick={clearCoupon}
              className="px-4 py-2 rounded-lg border border-white/20 text-xs font-bold uppercase tracking-wider hover:border-white/50"
            >
              Remove
            </button>
          ) : (
            <button
              type="button"
              onClick={applyCoupon}
              disabled={couponBusy || !couponInput.trim() || loading || !!payload}
              className="px-4 py-2 rounded-lg border border-white/20 text-xs font-bold uppercase tracking-wider hover:border-white/50 disabled:opacity-50"
            >
              {couponBusy ? "Checking…" : "Apply"}
            </button>
          )}
        </div>
        {couponMsg && (
          <p
            className={`mt-2 text-xs ${coupon ? "text-emerald-300" : "text-amber-300"}`}
            role="status"
          >
            {couponMsg}
          </p>
        )}
        <p className="mt-2 text-[11px] text-white/45">
          Credit or access codes are redeemed on the{" "}
          <AppLink to={ROUTES.redeem} className="underline hover:text-white">
            redeem page
          </AppLink>
          .
        </p>
      </div>

      <button
        onClick={start}
        disabled={loading || !!payload}
        className="w-full px-6 py-3.5 rounded-full bg-gradient-brand text-white font-bold text-sm shadow-[0_0_40px_-5px_hsl(295_90%_60%/0.7)] disabled:opacity-60"
      >
        {loading || payload ? "Redirecting to PayFast…" : "Pay with PayFast →"}
      </button>

      {slow && !payload && !error && (
        <div className="mt-4 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-200 space-y-2">
          <div>This is taking longer than usual. PayFast may be slow to respond.</div>
          <div className="flex gap-3">
            <button
              onClick={() => {
                setLoading(false);
                setSlow(false);
                start();
              }}
              className="underline"
            >
              Retry now
            </button>
            <AppLink to={ROUTES.pricing} className="underline">
              Back to pricing
            </AppLink>
          </div>
        </div>
      )}

      {payload && (
        <form ref={formRef} method="POST" action={payload.action} className="hidden">
          {Object.entries(payload.fields).map(([k, v]) => (
            <input key={k} type="hidden" name={k} value={v} />
          ))}
        </form>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <div className="text-white/55 text-[11px] uppercase tracking-widest">{label}</div>
      <div className="text-white text-sm text-right truncate">{value}</div>
    </div>
  );
}

function AuthBlock({ onSignedIn }: { onSignedIn: () => void }) {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        onSignedIn();
      } else {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: `${window.location.origin}/checkout${window.location.search}` },
        });
        if (error) throw error;
        if (data.session) onSignedIn();
        else setNotice("Check your email to confirm your account, then return here.");
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <p className="text-white/70 text-sm">
        {mode === "signin"
          ? "Sign in to continue to PayFast."
          : "Create your Resonance account to continue."}
      </p>
      <div>
        <label className="text-[11px] uppercase tracking-widest text-white/55">Email</label>
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="mt-1 w-full rounded-lg border border-white/15 bg-white/[0.04] px-3 py-2.5 text-sm outline-none focus:border-white/40"
        />
      </div>
      <div>
        <label className="text-[11px] uppercase tracking-widest text-white/55">Password</label>
        <input
          type="password"
          required
          minLength={6}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mt-1 w-full rounded-lg border border-white/15 bg-white/[0.04] px-3 py-2.5 text-sm outline-none focus:border-white/40"
        />
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">
          {error}
        </div>
      )}
      {notice && (
        <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm text-emerald-300">
          {notice}
        </div>
      )}

      <button
        type="submit"
        disabled={busy}
        className="w-full px-6 py-3 rounded-full bg-gradient-brand text-white font-bold text-sm disabled:opacity-60"
      >
        {busy ? "Please wait…" : mode === "signin" ? "Sign in & continue" : "Create account & continue"}
      </button>

      <button
        type="button"
        onClick={() => {
          setMode(mode === "signin" ? "signup" : "signin");
          setError(null);
          setNotice(null);
        }}
        className="block w-full text-center text-xs text-white/60 hover:text-white"
      >
        {mode === "signin" ? "New here? Create an account →" : "Already have an account? Sign in →"}
      </button>
    </form>
  );
}
