import { createFileRoute, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ROUTES } from "@/lib/routes";

// The `supabase.auth.oauth` namespace is beta and may not appear in generated
// types. Narrow to just the three methods we use.
type OAuthDetails = {
  client?: { name?: string; redirect_uri?: string } | null;
  scope?: string | null;
  redirect_url?: string | null;
  redirect_to?: string | null;
};
type OAuthApi = {
  getAuthorizationDetails(id: string): Promise<{ data: OAuthDetails | null; error: { message: string } | null }>;
  approveAuthorization(id: string): Promise<{ data: OAuthDetails | null; error: { message: string } | null }>;
  denyAuthorization(id: string): Promise<{ data: OAuthDetails | null; error: { message: string } | null }>;
};
function oauthApi(): OAuthApi {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (supabase.auth as any).oauth as OAuthApi;
}

export const Route = createFileRoute("/.lovable/oauth/consent")({
  ssr: false,
  validateSearch: (s: Record<string, unknown>) => ({
    authorization_id: typeof s.authorization_id === "string" ? s.authorization_id : "",
  }),
  beforeLoad: async ({ search, location }) => {
    if (!search.authorization_id) throw new Error("Missing authorization_id");
    const { data } = await supabase.auth.getSession();
    if (!data.session) {
      const next = location.pathname + location.searchStr;
      throw redirect({ to: ROUTES.login, search: { next } });
    }
  },
  loader: async ({ location }) => {
    const authorizationId = new URLSearchParams(location.search).get("authorization_id")!;
    const { data, error } = await oauthApi().getAuthorizationDetails(authorizationId);
    if (error) throw new Error(error.message);
    const immediate = data?.redirect_url ?? data?.redirect_to;
    if (immediate && !data?.client) throw redirect({ href: immediate });
    return data;
  },
  component: Consent,
  errorComponent: ({ error }) => (
    <main className="min-h-screen bg-[#0b0b12] text-white flex items-center justify-center px-4">
      <div className="max-w-md text-sm text-white/70">
        Could not load this authorization request: {String((error as Error)?.message ?? error)}
      </div>
    </main>
  ),
});

function scopeLabel(scope: string): string {
  const map: Record<string, string> = {
    openid: "Verify your identity",
    email: "See your email address",
    profile: "See your basic profile",
  };
  return map[scope] ?? `Additional permission: ${scope}`;
}

function Consent() {
  const details = Route.useLoaderData();
  const { authorization_id } = Route.useSearch();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clientName = details?.client?.name ?? "an app";
  const scopes = (details?.scope ?? "").split(/\s+/).filter(Boolean);

  async function decide(approve: boolean) {
    setBusy(true);
    setError(null);
    const api = oauthApi();
    const { data, error } = approve
      ? await api.approveAuthorization(authorization_id)
      : await api.denyAuthorization(authorization_id);
    if (error) {
      setBusy(false);
      setError(error.message);
      return;
    }
    const target = data?.redirect_url ?? data?.redirect_to;
    if (!target) {
      setBusy(false);
      setError("No redirect returned by the authorization server.");
      return;
    }
    window.location.href = target;
  }

  return (
    <main className="min-h-screen bg-[#0b0b12] text-white flex items-center justify-center px-4">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-white/[0.03] p-8">
        <h1 className="text-xl font-semibold tracking-tight">
          Connect {clientName} to Reson8
        </h1>
        <p className="mt-2 text-sm text-white/70">
          {clientName} will be able to call this app&rsquo;s enabled tools while you are signed in.
        </p>

        {scopes.length > 0 && (
          <ul className="mt-5 space-y-2 text-sm text-white/80">
            {scopes.map((s: string) => (
              <li key={s} className="flex items-start gap-2">
                <span className="mt-1 h-1.5 w-1.5 rounded-full bg-white/50" />
                <span>{scopeLabel(s)}</span>
              </li>
            ))}
          </ul>
        )}

        <p className="mt-5 text-xs text-white/50">
          This does not bypass Reson8&rsquo;s permissions or backend policies.
        </p>

        {error && (
          <div className="mt-4 rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300" role="alert">
            {error}
          </div>
        )}

        <div className="mt-6 flex gap-3">
          <button
            type="button"
            disabled={busy}
            onClick={() => decide(false)}
            className="flex-1 rounded-lg border border-white/15 bg-white/[0.04] py-2.5 text-sm hover:bg-white/[0.08] disabled:opacity-60"
          >
            Cancel connection
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => decide(true)}
            className="flex-1 rounded-lg bg-white text-black py-2.5 text-sm font-medium disabled:opacity-60"
          >
            {busy ? "Please wait…" : "Approve"}
          </button>
        </div>

        <a
          href="/"
          className="mt-4 block text-center text-xs text-white/60 hover:text-white"
        >
          Back to Hub
        </a>
      </div>
    </main>
  );
}
