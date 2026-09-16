import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { requireAdminRoute } from "@/lib/admin-auth-client";
import { checkEmailDomain, type RecordCheck } from "@/lib/email-domain.functions";
import { ROUTES } from "@/lib/routes";
import { AppLink } from "@/components/AppLink";

export const Route = createFileRoute("/admin/email-domain")({
  head: () => ({
    meta: [
      { title: "Email Domain Verification | RONSAS Admin" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  beforeLoad: requireAdminRoute,
  component: EmailDomainPage,
});

function StatusChip({ ok, okText, pendingText }: { ok: boolean; okText: string; pendingText: string }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${ok ? "bg-emerald-500/15 text-emerald-300" : "bg-amber-500/15 text-amber-300"}`}>
      {ok ? `? ${okText}` : `? ${pendingText}`}
    </span>
  );
}

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
  const shownDomain = result?.domain ?? "reson8.life";

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-4xl px-6 py-12">
        <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">RONSAS Admin</p>
            <h1 className="mt-2 text-3xl font-semibold">Email sender domain</h1>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Verify sovereign transactional-email DNS for{" "}
              <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{shownDomain}</code>.
              {" "}<AppLink to={ROUTES.adminEmails} className="text-primary hover:underline">Back to delivery log ?</AppLink>
            </p>
          </div>
          <button onClick={() => refetch()} disabled={isFetching} className="rounded-lg bg-primary-surface px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 transition disabled:opacity-50">
            {isFetching ? "Rechecking?" : "Recheck verification"}
          </button>
        </header>

        {errorMsg && <div className="mb-6 rounded-lg border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-300">{errorMsg}</div>}

        {result && (
          <>
            <section className={`mb-6 rounded-xl border p-5 ${result.ready ? "border-emerald-500/40 bg-emerald-500/5" : "border-amber-500/40 bg-amber-500/5"}`}>
              <p className="text-xs uppercase tracking-wider text-muted-foreground">Overall status</p>
              <p className={`mt-1 text-xl font-semibold ${result.ready ? "text-emerald-300" : "text-amber-300"}`}>
                {result.ready ? "? Sovereign email transport ready" : `${result.verifiedCount} of ${result.totalCount} required DNS records verified`}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <StatusChip ok={result.transportConfigured} okText="API credential configured" pendingText="API credential pending" />
                <StatusChip ok={result.webhookConfigured} okText="Webhook secret configured" pendingText="Webhook secret pending" />
              </div>
              <p className="mt-2 text-xs text-muted-foreground">Last checked {new Date(result.checkedAt).toLocaleString()}</p>
            </section>

            <ol className="mb-8 space-y-2 rounded-xl border border-border bg-card p-5 text-sm">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Setup steps</p>
              <li><strong className="text-foreground">1. Add the sender domain in Resend.</strong> Use <code className="font-mono text-xs">{shownDomain}</code> or set <code className="font-mono text-xs">RONS_EMAIL_SENDER_DOMAIN</code> before activation.</li>
              <li><strong className="text-foreground">2. Add the exact DNS records to Cloudflare.</strong> Resend normally uses <code className="font-mono text-xs">{result.returnPathHost}</code> for SPF/MX and <code className="font-mono text-xs">{result.dkimHost}</code> for DKIM. Do not delegate nameservers away from Cloudflare.</li>
              <li><strong className="text-foreground">3. Configure RONS-owned secrets.</strong> Set <code className="font-mono text-xs">RONS_RESEND_API_KEY</code> and <code className="font-mono text-xs">RONS_RESEND_WEBHOOK_SECRET</code> on Ealiophin; never place their values in source control.</li>
              <li><strong className="text-foreground">4. Register the suppression webhook.</strong> Point Resend to <code className="font-mono text-xs">https://reson8.life{result.webhookPath}</code> for bounce, complaint, suppression, and contact-update events.</li>
              <li><strong className="text-foreground">5. Recheck.</strong> Required SPF/MX/DKIM records must be green; DMARC is strongly recommended and can be tightened after delivery testing.</li>
            </ol>

            <div className="space-y-3">{result.checks.map((record) => <CheckRow key={record.label} check={record} />)}</div>
          </>
        )}

        {!result && !errorMsg && <p className="text-sm text-muted-foreground">Checking DNS records?</p>}
      </div>
    </div>
  );
}

function CheckRow({ check }: { check: RecordCheck }) {
  return (
    <div className={`rounded-xl border bg-card p-5 ${check.ok ? "border-emerald-500/30" : check.required ? "border-amber-500/30" : "border-border"}`}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-3">
            <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${check.ok ? "bg-emerald-500/15 text-emerald-300" : check.required ? "bg-amber-500/15 text-amber-300" : "bg-muted text-muted-foreground"}`}>
              {check.ok ? "? Verified" : check.required ? "? Required" : "Recommended"}
            </span>
            <h3 className="text-base font-semibold">{check.label}</h3>
            <span className="text-xs font-mono text-muted-foreground">{check.type}</span>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">{check.detail}</p>
          <dl className="mt-3 grid gap-2 text-xs">
            <div><dt className="text-muted-foreground">Host</dt><dd className="mt-0.5 font-mono break-all">{check.host}</dd></div>
            <div><dt className="text-muted-foreground">Expected value</dt><dd className="mt-0.5 font-mono break-all text-muted-foreground">{check.expectedHint}</dd></div>
            {check.found.length > 0 && (
              <div><dt className="text-muted-foreground">Found</dt><dd className="mt-0.5 space-y-1">{check.found.map((value, index) => <code key={index} className="block break-all rounded bg-muted/40 p-2 font-mono text-xs">{value}</code>)}</dd></div>
            )}
          </dl>
        </div>
      </div>
    </div>
  );
}
