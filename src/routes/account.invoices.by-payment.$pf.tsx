// @no-back-to-hub authenticated account area with its own nav
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { findInvoiceByPfPaymentId } from "@/lib/invoices.functions";

export const Route = createFileRoute("/account/invoices/by-payment/$pf")({
  head: () => ({
    meta: [
      { title: "Receipt lookup — Resonance" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth" });
  },
  component: ByPaymentPage,
});

function ByPaymentPage() {
  const { pf } = Route.useParams();
  const fetchFn = useServerFn(findInvoiceByPfPaymentId);
  const { data, isLoading, error } = useQuery({
    queryKey: ["invoice-by-pf", pf],
    queryFn: () => fetchFn({ data: { pfPaymentId: pf } }),
  });

  if (isLoading) {
    return <main className="mx-auto max-w-2xl px-6 py-16 text-sm text-muted-foreground">Looking up receipt…</main>;
  }

  if (error) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-16 space-y-4">
        <h1 className="text-2xl font-semibold">Receipt lookup failed</h1>
        <p className="text-sm text-destructive">{(error as Error).message}</p>
        <BackLinks />
      </main>
    );
  }

  if (data?.id) {
    // Client-side navigation to the receipt page.
    if (typeof window !== "undefined") {
      window.location.replace(`/account/invoices/${data.id}`);
    }
    return (
      <main className="mx-auto max-w-2xl px-6 py-16 space-y-4">
        <p className="text-sm text-muted-foreground">Redirecting to receipt…</p>
        <Link to="/account/invoices/$id" params={{ id: data.id }} className="underline">
          Open receipt
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-2xl px-6 py-16 space-y-4">
      <h1 className="text-2xl font-semibold">No receipt found</h1>
      <p className="text-sm text-muted-foreground">
        No invoice is linked to PayFast payment{" "}
        <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">{pf}</code>. It may not have
        been issued yet, or you may not have access to it.
      </p>
      <BackLinks />
    </main>
  );
}

function BackLinks() {
  return (
    <div className="flex gap-4 text-sm">
      <Link to="/account/invoices" className="underline">All invoices</Link>
      <Link to="/account/billing" className="underline">Billing</Link>
    </div>
  );
}
