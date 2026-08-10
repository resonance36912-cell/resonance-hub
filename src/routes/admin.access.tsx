import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getAdminAccessStatus } from "@/lib/admin-access.functions";
import { BackToHubHeader } from "@/components/BackToHubHeader";
import { AppLink } from "@/components/AppLink";
import { ROUTES } from "@/lib/routes";

export const Route = createFileRoute("/admin/access")({
  head: () => ({
    meta: [
      { title: "Admin access check — Resonance Hub" },
      {
        name: "description",
        content:
          "Check whether your signed-in Resonance Hub account holds the admin role and see how first-admin bootstrap is configured.",
      },
      { property: "og:title", content: "Admin access check — Resonance Hub" },
      {
        property: "og:description",
        content:
          "Verify your admin role on Resonance Hub and understand how bootstrap admin promotion works.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: AdminAccessPage,
});

function Pill({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-bold ${
        ok ? "text-emerald-500 border-emerald-500/40" : "text-muted-foreground"
      }`}
    >
      <span aria-hidden="true">{ok ? "✓" : "•"}</span>
      {children}
    </span>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b py-2 last:border-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-medium">{value}</span>
    </div>
  );
}

function AdminAccessPage() {
  const statusFn = useServerFn(getAdminAccessStatus);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);

  // Session lives in localStorage, so resolve auth state after hydration.
  useEffect(() => {
    let active = true;
    supabase.auth.getUser().then(({ data }) => {
      if (active) setSignedIn(Boolean(data.user));
    });
    return () => {
      active = false;
    };
  }, []);

  const statusQ = useQuery({
    queryKey: ["admin-access-status"],
    queryFn: () => statusFn(),
    enabled: signedIn === true,
    retry: false,
  });

  const s = statusQ.data;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-3xl mx-auto px-4 py-10 space-y-8">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold">Admin access check</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Whether this signed-in account holds the admin role, and how the
              first-admin bootstrap is configured on the server.
            </p>
          </div>
          <BackToHubHeader
            extra={
              <AppLink to={ROUTES.admin} className="text-primary underline">
                Admin home
              </AppLink>
            }
          />
        </header>

        {signedIn === null && (
          <p className="text-sm text-muted-foreground">Checking your session…</p>
        )}

        {signedIn === false && (
          <section className="rounded-lg border bg-card p-5 space-y-3">
            <h2 className="font-bold">You are not signed in</h2>
            <p className="text-sm text-muted-foreground">
              Admin authority is attached to a user account, so sign in first and
              this page will report your role.
            </p>
            <AppLink
              to={ROUTES.adminLogin}
              className="inline-block px-5 py-2.5 rounded-full bg-primary-surface text-primary-foreground font-bold text-sm"
            >
              Go to admin sign-in
            </AppLink>
          </section>
        )}

        {signedIn && statusQ.isLoading && (
          <p className="text-sm text-muted-foreground">Loading your access status…</p>
        )}

        {signedIn && statusQ.error && (
          <p className="text-sm text-destructive" role="alert">
            {(statusQ.error as Error).message}
          </p>
        )}

        {s && (
          <>
            <section
              className={`rounded-lg border p-5 ${
                s.isAdmin ? "border-emerald-500/40 bg-emerald-500/5" : "bg-card"
              }`}
            >
              <h2 className="text-xl font-bold">
                {s.isAdmin
                  ? "This account has the admin role"
                  : "This account does not have the admin role"}
              </h2>
              <p className="text-sm text-muted-foreground mt-2">
                {s.isAdmin
                  ? "Admin-only pages such as coupons, credits and billing are available to you."
                  : "Admin pages will redirect you to the admin sign-in screen until the role is granted."}
              </p>
              <div className="flex flex-wrap gap-2 mt-4">
                <Pill ok={s.isAdmin}>admin role</Pill>
                <Pill ok={s.emailVerified}>email verified</Pill>
                <Pill ok={s.anyAdminExists}>an admin exists</Pill>
              </div>
            </section>

            <section className="rounded-lg border bg-card p-5">
              <h2 className="font-bold mb-3">Your account</h2>
              <Row label="Signed-in email" value={s.email ?? "—"} />
              <Row
                label="Roles on record"
                value={s.roles.length ? s.roles.join(", ") : "none"}
              />
              <Row label="Email verified" value={s.emailVerified ? "Yes" : "No"} />
            </section>

            <section className="rounded-lg border bg-card p-5 space-y-4">
              <div>
                <h2 className="font-bold">How bootstrap admin is configured</h2>
                <p className="text-sm text-muted-foreground mt-1">
                  There is no hardcoded admin account and no admin password. Admin
                  authority comes only from a row in the roles table for your user
                  id. The bootstrap routine can grant that row exactly once, on a
                  fresh deployment, and only under all of these conditions:
                </p>
              </div>

              <ol className="space-y-3 text-sm">
                <li className="flex gap-3">
                  <span className="font-mono text-xs text-muted-foreground mt-0.5">1</span>
                  <span>
                    <span className="font-bold">No admin exists yet.</span> Once any
                    account holds the admin role, bootstrap is a permanent no-op.
                    <span className="block text-xs text-muted-foreground mt-1">
                      Currently: {s.anyAdminExists ? "an admin already exists → bootstrap is closed" : "no admin exists yet → bootstrap can still run"}
                    </span>
                  </span>
                </li>
                <li className="flex gap-3">
                  <span className="font-mono text-xs text-muted-foreground mt-0.5">2</span>
                  <span>
                    <span className="font-bold">
                      The server-side allowlist is set.
                    </span>{" "}
                    A secret holds a comma-separated list of emails allowed to claim
                    the first admin role. If it is empty, bootstrap does nothing —
                    this is what stops whoever signs up first from taking admin.
                    <span className="block text-xs text-muted-foreground mt-1">
                      Currently:{" "}
                      {s.bootstrapConfigured
                        ? `configured with ${s.bootstrapEntryCount} email${s.bootstrapEntryCount === 1 ? "" : "s"} (values are never shown here)`
                        : "not configured → bootstrap is disabled"}
                    </span>
                  </span>
                </li>
                <li className="flex gap-3">
                  <span className="font-mono text-xs text-muted-foreground mt-0.5">3</span>
                  <span>
                    <span className="font-bold">
                      Your signed-in email is on that allowlist.
                    </span>{" "}
                    The email is read from your verified session token on the server,
                    never from anything the browser sends.
                    <span className="block text-xs text-muted-foreground mt-1">
                      Currently: {s.selfAllowlisted ? "your email is on the allowlist" : "your email is not on the allowlist"}
                    </span>
                  </span>
                </li>
              </ol>

              <p className="text-sm text-muted-foreground">
                {s.isAdmin
                  ? "You already hold the role, so no bootstrap is needed."
                  : s.anyAdminExists
                    ? "Because an admin already exists, the only way to gain the role is for an existing admin to grant it to your account."
                    : s.bootstrapConfigured && s.selfAllowlisted
                      ? "All conditions are met — signing in through the admin sign-in page will promote this account."
                      : "Bootstrap cannot promote this account right now. Add your email to the server-side allowlist secret, then sign in again."}
              </p>
            </section>
          </>
        )}
      </div>
    </div>
  );
}
