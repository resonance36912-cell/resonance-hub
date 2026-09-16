import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { getCurrentAdminAccess } from "@/lib/admin-access.functions";
import { redirectAuthenticatedAdmin } from "@/lib/admin-auth-client";
import { ronsAuth } from "@/lib/auth-provider";

export const Route = createFileRoute("/admin/login")({
  head: () => ({
    meta: [{ title: "Admin Login — Resonance" }, { name: "robots", content: "noindex, nofollow" }],
  }),
  beforeLoad: redirectAuthenticatedAdmin,
  component: AdminLoginPage,
});

function AdminLoginPage() {
  const navigate = useNavigate();
  // Only expose the "Create account" tab when an invite query param is present
  // (e.g. /admin/login?invite=1). Account creation does not grant admin access.
  const signupAllowed =
    typeof window !== "undefined" && new URLSearchParams(window.location.search).has("invite");
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function routeSignedInUser() {
    const access = await getCurrentAdminAccess();
    if (!access.authenticated)
      throw new Error("Signed-in session was not available to the admin guard");
    if (access.isAdmin) await navigate({ to: "/admin" });
    else await navigate({ to: "/admin/access" });
  }

  useEffect(() => {
    // Handle case where user lands on this page already signed in
    // (e.g. after email confirmation link, or returning after sign-in).
    let cancelled = false;
    ronsAuth.getUser().then(({ data }) => {
      if (cancelled || !data.user) return;
      void routeSignedInUser().catch(() => {
        if (!cancelled) {
          setError("We couldn't check admin access. Please try signing in again.");
        }
      });
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (mode === "signin") {
        const { data, error } = await ronsAuth.signInWithPassword({ email, password });
        if (error) throw error;
        if (data.user) {
          await routeSignedInUser();
        }
      } else {
        if (!signupAllowed) {
          throw new Error(
            "Account creation is disabled. Contact an existing admin for an invite link.",
          );
        }
        const { data, error } = await ronsAuth.signUp({
          email,
          password,
          redirectTo: `${window.location.origin}/admin/login`,
        });
        if (error) throw error;
        if (!data.session) {
          setNotice(
            "Check your email to confirm your account, then return here to sign in and review admin access.",
          );
        } else if (data.user) {
          await routeSignedInUser();
        }
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-background text-foreground flex items-center justify-center px-6">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">Resonance</p>
          <h1 className="mt-2 text-3xl font-semibold">
            Admin {mode === "signin" ? "Sign In" : "Sign Up"}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Restricted access. Sign in with your authorised admin account.
          </p>
        </div>

        {signupAllowed && (
          <div className="mb-4 flex rounded-full border border-border bg-card p-1 text-sm">
            <button
              type="button"
              onClick={() => {
                setMode("signin");
                setError(null);
                setNotice(null);
              }}
              className={`flex-1 rounded-full px-4 py-2 transition ${
                mode === "signin"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Sign in
            </button>
            <button
              type="button"
              onClick={() => {
                setMode("signup");
                setError(null);
                setNotice(null);
              }}
              className={`flex-1 rounded-full px-4 py-2 transition ${
                mode === "signup"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Create account
            </button>
          </div>
        )}

        <form onSubmit={submit} className="space-y-4 rounded-2xl border border-border bg-card p-6">
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
          <div>
            <label className="text-[11px] uppercase tracking-widest text-muted-foreground">
              Email
            </label>
            <input
              type="email"
              required
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm outline-none focus:border-primary"
            />
          </div>
          <div>
            <label className="text-[11px] uppercase tracking-widest text-muted-foreground">
              Password
            </label>
            <input
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm outline-none focus:border-primary"
            />
          </div>
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60"
          >
            {busy
              ? mode === "signin"
                ? "Signing in…"
                : "Creating account…"
              : mode === "signin"
                ? "Sign in"
                : "Create account"}
          </button>
          <p className="text-center text-xs text-muted-foreground">
            <Link to="/" className="hover:underline">
              ← Back to Hub
            </Link>
          </p>
        </form>
      </div>
    </div>
  );
}
