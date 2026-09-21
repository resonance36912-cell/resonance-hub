import { createServerFn } from "@tanstack/react-start";
import { sendRonsEmail } from "@/lib/email-provider.server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  determineAdminBootstrapStatus,
  isAdminBootstrapToken,
  parseAdminBootstrapChallengeResult,
  parseAdminBootstrapResult,
  type AdminBootstrapStatus,
} from "@/lib/admin-bootstrap.core";

const BOOTSTRAP_FROM = "Resonance Hub <noreply@www.reson8.life>";
const BOOTSTRAP_SENDER_DOMAIN = "notify.www.reson8.life";
const DEFAULT_BOOTSTRAP_BASE_URL = "https://reson8.life";

type CanonicalUser = {
  id: string;
  email?: string;
  email_confirmed_at?: string;
};

type CheckedBootstrapAccess = {
  status: AdminBootstrapStatus;
  verifiedEmail: string | null;
};

function requireCanonicalUser(
  userId: string,
  result: { data: { user: CanonicalUser | null }; error: unknown },
): CanonicalUser {
  if (result.error || !result.data.user || result.data.user.id !== userId) {
    throw new Error("Unable to verify your session. Please sign in again.");
  }
  return result.data.user;
}

async function loadBootstrapAccess(
  userId: string,
  user: CanonicalUser,
): Promise<CheckedBootstrapAccess> {
  const [ownRoleResult, anyAdminResult, claimResult] = await Promise.all([
    supabaseAdmin
      .from("user_roles")
      .select("id")
      .eq("user_id", userId)
      .eq("role", "admin")
      .limit(1),
    supabaseAdmin.from("user_roles").select("id").eq("role", "admin").limit(1),
    supabaseAdmin.from("admin_bootstrap_state").select("singleton").limit(1),
  ]);

  const firstError = ownRoleResult.error ?? anyAdminResult.error ?? claimResult.error;
  if (firstError) {
    console.error("[Admin bootstrap] Status check failed");
    throw new Error("Unable to check first-admin access. Please try again.");
  }

  const status = determineAdminBootstrapStatus({
    email: user?.email,
    emailConfirmedAt: user?.email_confirmed_at,
    isAdmin: Boolean(ownRoleResult.data?.length),
    adminExists: Boolean(anyAdminResult.data?.length),
    bootstrapClaimed: Boolean(claimResult.data?.length),
    // This value is deliberately read only inside this server-function module.
    allowlistRaw: process.env.ADMIN_BOOTSTRAP_EMAILS,
  });

  return {
    status,
    verifiedEmail: user.email && user.email_confirmed_at ? user.email.trim().toLowerCase() : null,
  };
}

function generateBootstrapToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const binary = String.fromCharCode(...bytes);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

async function hashBootstrapToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function bootstrapVerificationUrl(token: string): string {
  const configuredBase =
    process.env.ADMIN_BOOTSTRAP_BASE_URL ?? process.env.HUB_URL ?? DEFAULT_BOOTSTRAP_BASE_URL;
  const url = new URL(configuredBase);
  const isLocalDevelopment = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(isLocalDevelopment && url.protocol === "http:")) {
    throw new Error("First-admin verification URL must use HTTPS.");
  }

  url.pathname = "/admin/access";
  url.search = "";
  url.hash = "";
  url.searchParams.set("bootstrap_token", token);
  return url.toString();
}

async function sendBootstrapVerificationEmail({
  email,
  token,
  tokenHash,
  userId,
}: {
  email: string;
  token: string;
  tokenHash: string;
  userId: string;
}): Promise<void> {
  const apiKey = process.env.RONS_EMAIL_API_KEY ?? process.env.LOVABLE_API_KEY;
  if (!apiKey) throw new Error("First-admin verification email is not configured.");

  const verificationUrl = bootstrapVerificationUrl(token);
  const htmlUrl = verificationUrl.replaceAll("&", "&amp;").replaceAll('"', "&quot;");
  const messageId = crypto.randomUUID();

  await sendRonsEmail(
    {
      to: email,
      from: BOOTSTRAP_FROM,
      sender_domain: BOOTSTRAP_SENDER_DOMAIN,
      subject: "Verify first-administrator setup",
      html: `<p>A request was made to create the first Resonance Hub administrator.</p><p><a href="${htmlUrl}">Verify this email and continue</a></p><p>This single-use link expires in 15 minutes. If you did not request it, ignore this message.</p>`,
      text: `A request was made to create the first Resonance Hub administrator.\n\nVerify this email and continue: ${verificationUrl}\n\nThis single-use link expires in 15 minutes. If you did not request it, ignore this message.`,
      purpose: "transactional",
      label: "admin-bootstrap-email-verification",
      idempotency_key: `admin-bootstrap-${userId}-${tokenHash.slice(0, 16)}`,
      message_id: messageId,
    },
  );
}

export const getAdminBootstrapStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => {
    const token =
      input && typeof input === "object" && "token" in input
        ? (input as { token?: unknown }).token
        : null;
    return { token: isAdminBootstrapToken(token) ? token : null };
  })
  .handler(async ({ context, data }) => {
    const user = requireCanonicalUser(context.userId, await context.supabase.auth.getUser());
    const { status } = await loadBootstrapAccess(context.userId, user);
    if (status !== "eligible") return { status };
    if (!data.token) return { status: "email_reverification_required" as const };

    const tokenHash = await hashBootstrapToken(data.token);
    const { data: challenge, error } = await supabaseAdmin
      .from("admin_bootstrap_email_challenges")
      .select("user_id")
      .eq("user_id", context.userId)
      .eq("token_hash", tokenHash)
      .is("consumed_at", null)
      .gt("expires_at", new Date().toISOString())
      .limit(1);

    if (error) {
      console.error("[Admin bootstrap] Verification challenge check failed");
      throw new Error("Unable to check first-admin access. Please try again.");
    }

    return {
      status: challenge?.length
        ? ("eligible" as const)
        : ("email_reverification_required" as const),
    };
  });

/** Send a short-lived proof link only after every base eligibility check passes. */
export const requestAdminBootstrapVerification = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const user = requireCanonicalUser(context.userId, await context.supabase.auth.getUser());
    const { status, verifiedEmail } = await loadBootstrapAccess(context.userId, user);
    if (status !== "eligible") return { status };
    if (!verifiedEmail) return { status: "email_unverified" as const };

    const token = generateBootstrapToken();
    const tokenHash = await hashBootstrapToken(token);
    const { data, error } = await supabaseAdmin.rpc("create_admin_bootstrap_challenge", {
      _user_id: context.userId,
      _verified_email: verifiedEmail,
      _token_hash: tokenHash,
    });

    if (error) {
      console.error("[Admin bootstrap] Verification challenge creation failed");
      throw new Error("Unable to send the verification link. Please try again.");
    }

    const challengeResult = parseAdminBootstrapChallengeResult(data);
    if (challengeResult === "verification_recently_sent") {
      return { status: "verification_recently_sent" as const };
    }
    if (challengeResult !== "verification_created") return { status: challengeResult };

    try {
      await sendBootstrapVerificationEmail({
        email: verifiedEmail,
        token,
        tokenHash,
        userId: context.userId,
      });
    } catch {
      const cleanup = await supabaseAdmin.rpc("cancel_admin_bootstrap_challenge", {
        _user_id: context.userId,
        _token_hash: tokenHash,
      });
      if (cleanup.error) {
        console.error("[Admin bootstrap] Verification challenge cleanup failed");
      }
      console.error("[Admin bootstrap] Verification email send failed");
      throw new Error("Unable to send the verification link. Please try again.");
    }

    return { status: "verification_sent" as const };
  });

/**
 * Explicitly claim the one-time first-admin slot. Every eligibility predicate
 * is checked again here; the database RPC serializes contenders and records a
 * permanent claim so deleting every admin cannot re-open bootstrap access.
 */
export const bootstrapAdmin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => {
    const token =
      input && typeof input === "object" && "token" in input
        ? (input as { token?: unknown }).token
        : null;
    return { token: isAdminBootstrapToken(token) ? token : null };
  })
  .handler(async ({ context, data }) => {
    const user = requireCanonicalUser(context.userId, await context.supabase.auth.getUser());
    const { status, verifiedEmail } = await loadBootstrapAccess(context.userId, user);
    if (status !== "eligible") return { status };
    if (!verifiedEmail) return { status: "email_unverified" as const };
    if (!data.token) return { status: "email_reverification_required" as const };

    const tokenHash = await hashBootstrapToken(data.token);

    const { data: rpcResult, error } = await supabaseAdmin.rpc("bootstrap_first_admin", {
      _user_id: context.userId,
      _verified_email: verifiedEmail,
      _token_hash: tokenHash,
    });

    if (error) {
      console.error("[Admin bootstrap] Atomic claim failed");
      throw new Error("Unable to create the first admin. Please try again.");
    }

    return { status: parseAdminBootstrapResult(rpcResult) };
  });
