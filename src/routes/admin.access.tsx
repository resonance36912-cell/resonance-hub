import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import {
  bootstrapAdmin,
  getAdminBootstrapStatus,
  requestAdminBootstrapVerification,
} from "@/lib/admin-bootstrap.functions";
import type { AdminBootstrapResult } from "@/lib/admin-bootstrap.core";

type BootstrapOutcome =
  | AdminBootstrapResult
  | "email_reverification_required"
  | "verification_sent"
  | "verification_recently_sent";
type PageStatus = BootstrapOutcome | "signed_out";
type PageError = { title: string; description: string };
type TokenHolder = { value: string | null };

const BOOTSTRAP_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
let capturedBootstrapToken: string | null | undefined;

function captureBootstrapToken(): string | null {
  // React may invoke lazy state initializers twice in development. Cache the
  // first capture so scrubbing the URL cannot discard the proof on pass two.
  if (capturedBootstrapToken !== undefined) return capturedBootstrapToken;
  if (typeof window === "undefined") return null;

  const url = new URL(window.location.href);
  const candidate = url.searchParams.get("bootstrap_token");

  if (url.searchParams.has("bootstrap_token")) {
    url.searchParams.delete("bootstrap_token");
    const scrubbedUrl = `${url.pathname}${url.search}${url.hash}`;
    window.history.replaceState(window.history.state, "", scrubbedUrl);
  }

  capturedBootstrapToken = candidate && BOOTSTRAP_TOKEN_PATTERN.test(candidate) ? candidate : null;
  return capturedBootstrapToken;
}

const OUTCOMES = new Set<BootstrapOutcome>([
  "eligible",
  "already_admin",
  "closed",
  "email_unverified",
  "not_allowed",
  "bootstrapped",
  "email_reverification_required",
  "verification_sent",
  "verification_recently_sent",
]);

function readOutcome(value: unknown): BootstrapOutcome {
  const candidate =
    typeof value === "object" && value !== null && "status" in value
      ? (value as { status?: unknown }).status
      : value;

  if (typeof candidate === "string" && OUTCOMES.has(candidate as BootstrapOutcome)) {
    return candidate as BootstrapOutcome;
  }

  throw new Error("Unexpected admin bootstrap response");
}

const STATUS_COPY: Record<
  PageStatus,
  { title: string; description: string; tone: "default" | "success" }
> = {
  signed_out: {
    title: "Sign in required",
    description: "Sign in before checking whether this account can create the first administrator.",
    tone: "default",
  },
  eligible: {
    title: "Ready for first-admin setup",
    description:
      "This verified account is approved to create the first administrator. This action can only succeed once.",
    tone: "default",
  },
  already_admin: {
    title: "Administrator access already active",
    description: "This account already has administrator access. No further setup is needed.",
    tone: "success",
  },
  closed: {
    title: "First-admin setup is closed",
    description:
      "An administrator already exists or the one-time setup has already been used, so this action is no longer available.",
    tone: "default",
  },
  email_unverified: {
    title: "Verify your email",
    description:
      "Confirm the email address for this account, then refresh this status before trying again.",
    tone: "default",
  },
  email_reverification_required: {
    title: "Fresh email verification required",
    description:
      "Request a fresh verification link, then return through that link to continue first-admin setup.",
    tone: "default",
  },
  not_allowed: {
    title: "Account not approved",
    description:
      "This signed-in account is not approved for first-admin setup. Use an approved account or contact the site owner.",
    tone: "default",
  },
  bootstrapped: {
    title: "Administrator access created",
    description:
      "This account is now the first administrator. The one-time setup action is closed.",
    tone: "success",
  },
  verification_sent: {
    title: "Verification email sent",
    description:
      "Open the new verification link in your email to continue. The first-admin action remains unavailable until then.",
    tone: "success",
  },
  verification_recently_sent: {
    title: "Verification email already sent",
    description:
      "A verification email was sent recently. Check your inbox and wait before requesting another link.",
    tone: "default",
  },
};

export const Route = createFileRoute("/admin/access")({
  head: () => ({
    meta: [
      { title: "Admin Access — Resonance" },
      { name: "robots", content: "noindex, nofollow" },
      { name: "referrer", content: "no-referrer" },
    ],
  }),
  component: AdminAccessPage,
});

function AdminAccessPage() {
  const navigate = useNavigate();
  const getStatus = useServerFn(getAdminBootstrapStatus);
  const runBootstrap = useServerFn(bootstrapAdmin);
  const requestVerification = useServerFn(requestAdminBootstrapVerification);
  const [tokenHolder] = useState<TokenHolder>(() => ({ value: captureBootstrapToken() }));
  const [hasBootstrapToken, setHasBootstrapToken] = useState(() => tokenHolder.value !== null);
  const [status, setStatus] = useState<PageStatus | null>(null);
  const [checking, setChecking] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [requestingVerification, setRequestingVerification] = useState(false);
  const [switchingAccount, setSwitchingAccount] = useState(false);
  const [error, setError] = useState<PageError | null>(null);
  const checkingRef = useRef(false);
  const submittingRef = useRef(false);
  const requestingVerificationRef = useRef(false);
  const switchingAccountRef = useRef(false);

  function discardBootstrapToken() {
    capturedBootstrapToken = null;
    tokenHolder.value = null;
    setHasBootstrapToken(false);
  }

  async function refreshStatus() {
    if (checkingRef.current) return;
    checkingRef.current = true;
    setChecking(true);
    setError(null);

    try {
      const { data, error: authError } = await supabase.auth.getUser();
      if (authError) throw authError;
      if (!data.user) {
        setStatus("signed_out");
        return;
      }

      const response = await getStatus({ data: { token: tokenHolder.value ?? undefined } });
      const outcome = readOutcome(response);
      if (outcome !== "eligible") discardBootstrapToken();
      setStatus(outcome);
    } catch {
      setStatus(null);
      setError({
        title: "Admin access check failed",
        description: "We couldn't check admin access. Please try again.",
      });
    } finally {
      checkingRef.current = false;
      setChecking(false);
    }
  }

  useEffect(() => {
    void refreshStatus();
    // Run once on arrival; the explicit refresh action handles later changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function createFirstAdmin() {
    const capturedToken = tokenHolder.value;
    if (status !== "eligible" || submittingRef.current) return;

    submittingRef.current = true;
    setSubmitting(true);
    setError(null);
    try {
      const response = await runBootstrap({ data: { token: capturedToken ?? undefined } });
      const outcome = readOutcome(response);
      if (outcome !== "eligible") discardBootstrapToken();
      setStatus(outcome);
    } catch {
      setError({
        title: "First-admin setup failed",
        description:
          "We couldn't complete first-admin setup. No change was confirmed; please retry or refresh the status.",
      });
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  async function sendVerificationLink() {
    if (
      status !== "email_reverification_required" ||
      hasBootstrapToken ||
      requestingVerificationRef.current
    ) {
      return;
    }

    requestingVerificationRef.current = true;
    setRequestingVerification(true);
    setError(null);
    try {
      const response = await requestVerification();
      setStatus(readOutcome(response));
    } catch {
      setError({
        title: "Verification email not sent",
        description: "We couldn't send a verification link. Please try again.",
      });
    } finally {
      requestingVerificationRef.current = false;
      setRequestingVerification(false);
    }
  }

  async function useDifferentAccount() {
    if (switchingAccountRef.current) return;
    switchingAccountRef.current = true;
    setSwitchingAccount(true);
    setError(null);
    discardBootstrapToken();
    try {
      const { error: signOutError } = await supabase.auth.signOut();
      if (signOutError) throw signOutError;
      await navigate({ to: "/admin/login" });
    } catch {
      setError({
        title: "Sign out failed",
        description: "We couldn't sign out this account. Please try again.",
      });
      switchingAccountRef.current = false;
      setSwitchingAccount(false);
    }
  }

  const copy = status ? STATUS_COPY[status] : null;
  const canSwitchAccount =
    status === "closed" ||
    status === "email_unverified" ||
    status === "email_reverification_required" ||
    status === "verification_sent" ||
    status === "verification_recently_sent" ||
    status === "not_allowed";
  const canOpenAdmin = status === "already_admin" || status === "bootstrapped";
  const canCreateFirstAdmin = status === "eligible";

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6 py-12 text-foreground">
      <div className="w-full max-w-lg">
        <div className="mb-8 text-center">
          <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">Resonance</p>
          <h1 className="mt-2 text-3xl font-semibold">Admin access</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Secure, one-time setup for the first administrator.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>First administrator</CardTitle>
            <CardDescription>
              Your signed-in account and current setup state are checked securely before the action
              is shown.
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-4">
            {checking && (
              <div
                role="status"
                aria-live="polite"
                className="rounded-lg border border-border bg-background p-4 text-sm text-muted-foreground"
              >
                Checking admin access…
              </div>
            )}

            {!checking && error && (
              <Alert variant="destructive">
                <AlertTitle>{error.title}</AlertTitle>
                <AlertDescription>{error.description}</AlertDescription>
              </Alert>
            )}

            {!checking && copy && (
              <div
                role="status"
                aria-live="polite"
                aria-atomic="true"
                className={`rounded-lg border p-4 text-sm ${
                  copy.tone === "success"
                    ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                    : "border-border bg-background text-foreground"
                }`}
              >
                <p className="font-semibold">{copy.title}</p>
                <p className="mt-1 text-sm opacity-90">{copy.description}</p>
              </div>
            )}

            {!checking && canCreateFirstAdmin && (
              <Button
                type="button"
                size="lg"
                className="w-full"
                disabled={submitting}
                aria-busy={submitting}
                aria-describedby="first-admin-action-note"
                onClick={createFirstAdmin}
              >
                {submitting ? "Creating administrator…" : "Create first administrator"}
              </Button>
            )}

            {!checking && canCreateFirstAdmin && (
              <p id="first-admin-action-note" className="text-xs text-muted-foreground">
                The server re-checks every requirement when you continue. Repeated attempts are
                safe.
              </p>
            )}

            {!checking && status === "email_reverification_required" && !hasBootstrapToken && (
              <Button
                type="button"
                size="lg"
                className="w-full"
                disabled={requestingVerification}
                aria-busy={requestingVerification}
                onClick={sendVerificationLink}
              >
                {requestingVerification ? "Sending verification link…" : "Send verification link"}
              </Button>
            )}

            {!checking &&
              (error ||
                status === "email_unverified" ||
                status === "not_allowed" ||
                status === "verification_recently_sent") && (
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  disabled={submitting || requestingVerification}
                  onClick={refreshStatus}
                >
                  Refresh status
                </Button>
              )}

            {!checking && status === "signed_out" && (
              <Button asChild className="w-full">
                <Link to="/admin/login">Sign in</Link>
              </Button>
            )}

            {!checking && canOpenAdmin && (
              <Button asChild className="w-full">
                <Link to="/admin">Open admin dashboard</Link>
              </Button>
            )}

            {!checking && canSwitchAccount && (
              <Button
                type="button"
                variant="outline"
                className="w-full"
                disabled={switchingAccount || submitting || requestingVerification}
                onClick={useDifferentAccount}
              >
                {switchingAccount ? "Signing out…" : "Use a different account"}
              </Button>
            )}
          </CardContent>

          <CardFooter className="justify-center">
            <Link to="/" className="text-xs text-muted-foreground hover:underline">
              ← Back to Hub
            </Link>
          </CardFooter>
        </Card>
      </div>
    </main>
  );
}
