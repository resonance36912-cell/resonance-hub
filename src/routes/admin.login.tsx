import { createFileRoute, redirect, useNavigate, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { bootstrapAdmin } from "@/lib/admin-bootstrap.functions";

export const Route = createFileRoute("/admin/login")({
  head: () => ({
    meta: [
      { title: "Admin Login — Resonance" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  beforeLoad: async () => {
    const { data } = await supabase.auth.getUser();
    if (data.user) {
      const { data: role } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", data.user.id)
        .eq("role", "admin")
        .maybeSingle();
      if (role) throw redirect({ to: "/admin" });
    }
  },
  component: AdminLoginPage,
});

function AdminLoginPage() {
  const navigate = useNavigate();
  const promote = useServerFn(bootstrapAdmin);
  // Only expose the "Create account" tab when an invite query param is present
  // (e.g. /admin/login?invite=1). Server-side bootstrap is also gated by the
  // ADMIN_BOOTSTRAP_EMAILS allowlist — this is just UX hardening.
  const signupAllowed =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).has("invite");
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function finalizeAdmin(userId: string) {
    try {
      await promote();
    } catch {
      // ignore — role check below decides access
    }
    const { data: role } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .eq("role", "admin")
      .maybeSingle();
    if (role) {
      navigate({ to: "/admin" });
    } else {
      setError("This account does not have admin access. Ask an existing admin to grant the role.");
    }
  }

  useEffect(() => {
    // Handle case where user lands on this page already signed in
    // (e.g. after email confirmation link, or returning after sign-in).
    let cancelled = false;
    supabase.auth.getUser().then(({ data }) => {
      if (cancelled || !data.user) return;
      finalizeAdmin(data.user.id);
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
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        if (data.user) {
          await finalizeAdmin(data.user.id);
        }
      } else {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: `${window.location.origin}/admin/login` },
        });
        if (error) throw error;
        if (!data.session) {
          setNotice("Check your email to confirm your account, then return here to sign in.");
        } else if (data.user) {
          await finalizeAdmin(data.user.id);
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
              onClick={() => { setMode("signin"); setError(null); setNotice(null); }}
              className={`flex-1 rounded-full px-4 py-2 transition ${
                mode === "signin" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Sign in
            </button>
            <button
              type="button"
              onClick={() => { setMode("signup"); setError(null); setNotice(null); }}
              className={`flex-1 rounded-full px-4 py-2 transition ${
                mode === "signup" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
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
            <label className="text-[11px] uppercase tracking-widest text-muted-foreground">Email</label>
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
            <label className="text-[11px] uppercase tracking-widest text-muted-foreground">Password</label>
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
              ? (mode === "signin" ? "Signing in…" : "Creating account…")
              : (mode === "signin" ? "Sign in" : "Create admin account")}
          </button>
          <p className="text-center text-xs text-muted-foreground">
            <Link to="/" className="hover:underline">← Back to site</Link>
          </p>
        </form>
      </div>
    </div>
  );
}
