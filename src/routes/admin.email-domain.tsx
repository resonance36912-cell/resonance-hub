import { createFileRoute, redirect } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { checkEmailDomain, type RecordCheck } from "@/lib/email-domain.functions";
import { ROUTES } from "@/lib/routes";
import { AppLink } from "@/components/AppLink";

export const Route = createFileRoute("/admin/email-domain")({
  head: () => ({
    meta: [
      { title: "Email Domain Verification — Resonance Admin" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: ROUTES.adminLogin });
    const { data: roleRow } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", data.user.id)
      .eq("role", "admin")
      .maybeSingle();
    if (!roleRow) throw redirect({ to: ROUTES.adminLogin });
  },
  component: EmailDomainPage,
});

function EmailDomainPage() {
  const check = useServerFn(checkEmailDomain);
  const { data, isFetching, refetch, error } = useQuery({
    queryKey: ["admin-email-domain"],
    queryFn: () => check(),
    refetchOnWindowFocus: false,
  });

  const result = data && "ok" in data && data.ok ? data : null;
  const errorMsg =
    (data && "ok" in data && !data.ok ? data.error : null) ??
    (error instanceof Error ? error.message : null);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-4xl px-6 py-12">
        <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
              Resonance Admin
            </p>
            <h1 className="mt-2 text-3xl font-semibold">Email sender domain</h1>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Verify SPF, DKIM, and DMARC for{" "}
              <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                notify.www.reson8.life
              </code>
              . These records prove that PayFast subscription emails are
              authorized to be sent from your domain.{" "}
              <AppLink to={ROUTES.adminEmails} className="text-primary hover:underline">
                Back to delivery log →
              </AppLink>
            </p>
          </div>
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 transition disabled:opacity-50"
          >
            {isFetching ? "Rechecking…" : "Recheck verification"}
          </button>
        </header>

        {errorMsg && (
          <div className="mb-6 rounded-lg border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-300">
            {errorMsg}
          </div>
        )}

        {result && (
          <>
            <section
              className={`mb-6 rounded-xl border p-5 ${
                result.allVerified
                  ? "border-emerald-500/40 bg-emerald-500/5"
                  : "border-amber-500/40 bg-amber-500/5"
              }`}
            >
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-xs uppercase tracking-wider text-muted-foreground">
                    Overall status
                  </p>
                  <p
                    className={`mt-1 text-xl font-semibold ${
                      result.allVerified ? "text-emerald-300" : "text-amber-300"
                    }`}
                  >
                    {result.allVerified
                      ? "✓ Domain fully verified"
                      : `${result.verifiedCount} of ${result.totalCount} records verified`}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Last checked {new Date(result.checkedAt).toLocaleString()}
                  </p>
                </div>
              </div>
            </section>

            <ol className="mb-8 space-y-2 rounded-xl border border-border bg-card p-5 text-sm">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Setup steps
              </p>
              <li>
                <strong className="text-foreground">1. Delegate the subdomain.</strong>{" "}
                At your DNS provider, add <code className="font-mono text-xs">NS</code> records
                for <code className="font-mono text-xs">notify.www.reson8.life</code> pointing
                to <code className="font-mono text-xs">ns5.lovable.cloud</code> and{" "}
                <code className="font-mono text-xs">ns6.lovable.cloud</code>.
              </li>
              <li>
                <strong className="text-foreground">2. Wait for propagation.</strong>{" "}
                DNS can take up to 72 hours. Most providers update within minutes.
              </li>
              <li>
                <strong className="text-foreground">3. SPF, DKIM, DMARC.</strong>{" "}
                Once NS delegation is live, the SPF, DKIM, and DMARC records below
                are provisioned automatically on the delegated subdomain.
              </li>
              <li>
                <strong className="text-foreground">4. Recheck.</strong>{" "}
                Click <em>Recheck verification</em> above until every record turns green.
              </li>
            </ol>

            <div className="space-y-3">
              {result.checks.map((c) => (
                <CheckRow key={c.label} check={c} />
              ))}
            </div>
          </>
        )}

        {!result && !errorMsg && (
          <p className="text-sm text-muted-foreground">Checking DNS records…</p>
        )}
      </div>
    </div>
  );
}

function CheckRow({ check }: { check: RecordCheck }) {
  return (
    <div
      className={`rounded-xl border bg-card p-5 ${
        check.ok ? "border-emerald-500/30" : "border-amber-500/30"
      }`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-3">
            <span
              className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${
                check.ok
                  ? "bg-emerald-500/15 text-emerald-300"
                  : "bg-amber-500/15 text-amber-300"
              }`}
            >
              {check.ok ? "✓ Verified" : "⏳ Pending"}
            </span>
            <h3 className="text-base font-semibold">{check.label}</h3>
            <span className="text-xs font-mono text-muted-foreground">{check.type}</span>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">{check.detail}</p>

          <dl className="mt-3 grid gap-2 text-xs">
            <div>
              <dt className="text-muted-foreground">Host</dt>
              <dd className="mt-0.5 font-mono break-all">{check.host}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Expected value</dt>
              <dd className="mt-0.5 font-mono break-all text-muted-foreground">
                {check.expectedHint}
              </dd>
            </div>
            {check.found.length > 0 && (
              <div>
                <dt className="text-muted-foreground">Found</dt>
                <dd className="mt-0.5 space-y-1">
                  {check.found.map((f, i) => (
                    <code
                      key={i}
                      className="block break-all rounded bg-muted/40 p-2 font-mono text-xs"
                    >
                      {f}
                    </code>
                  ))}
                </dd>
              </div>
            )}
          </dl>
        </div>
      </div>
    </div>
  );
}
