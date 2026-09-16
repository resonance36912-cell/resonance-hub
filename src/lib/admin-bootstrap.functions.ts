import { createServerFn } from "@tanstack/react-start";
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
type CheckedBootstrapAccess = {
  status: AdminBootstrapStatus;
  canonicalEmail: string | null;
};

type BootstrapDelivery = "email" | "local_file";
const LOCAL_BOOTSTRAP_FILE = "admin-bootstrap-verification.url";

type BackendProvider = "supabase" | "sovereign";
type BackendUser = { id: string; email: string | null; emailConfirmedAt: string | null };
type RonsContext = {
  userId: string;
  user: BackendUser;
  credential: string;
  authProvider: BackendProvider;
};

async function requireRonsContext(): Promise<RonsContext> {
  const [{ getRequest }, middleware, backend] = await Promise.all([
    import("@tanstack/react-start/server"),
    import("@/lib/rons-auth-middleware"),
    import("@/lib/backend-provider.server"),
  ]);
  const request = getRequest();
  if (!request?.headers) throw new Error("Unauthorized: No request headers available");
  const credential = middleware.resolveRonsRequestCredential(request);
  if (!credential) throw new Error("Unauthorized: Invalid or missing session");
  const user = await middleware.resolveRonsRequestUser(request);
  if (!user) throw new Error("Unauthorized: Invalid or missing session");
  return { userId: user.id, user, credential, authProvider: backend.getBackendProvider() };
}

async function loadBootstrapAccess(
  userId: string,
  user: BackendUser,
  provider: BackendProvider,
  credential: string,
): Promise<CheckedBootstrapAccess> {
  let isAdmin = false;
  let adminExists = false;
  let bootstrapClaimed = false;

  if (provider === "sovereign") {
    const { readSovereignBootstrapState } = await import("@/lib/backend-provider.server");
    const state = await readSovereignBootstrapState(credential, userId);
    isAdmin = state.callerIsAdmin;
    adminExists = state.closed && !state.callerIsAdmin;
    bootstrapClaimed = state.closed;
  } else {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
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
    isAdmin = Boolean(ownRoleResult.data?.length);
    adminExists = Boolean(anyAdminResult.data?.length);
    bootstrapClaimed = Boolean(claimResult.data?.length);
  }

  const canonicalEmail = user.email?.trim().toLowerCase() ?? null;
  const emailConfirmedAt =
    provider === "sovereign"
      ? canonicalEmail
        ? "local-owner-verification"
        : null
      : user.emailConfirmedAt;
  const status = determineAdminBootstrapStatus({
    email: canonicalEmail,
    emailConfirmedAt,
    isAdmin,
    adminExists,
    bootstrapClaimed,
    allowlistRaw: process.env.ADMIN_BOOTSTRAP_EMAILS,
  });

  return {
    status,
    canonicalEmail:
      status === "eligible" && canonicalEmail && emailConfirmedAt ? canonicalEmail : null,
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
function bootstrapVerificationUrl(token: string, provider: BackendProvider): string {
  const fallback = provider === "sovereign" ? "http://127.0.0.1:4173" : DEFAULT_BOOTSTRAP_BASE_URL;
  const configuredBase = process.env.ADMIN_BOOTSTRAP_BASE_URL ?? process.env.HUB_URL ?? fallback;
  const url = new URL(configuredBase);
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) {
    throw new Error("First-admin verification URL must use HTTPS or loopback HTTP.");
  }
  url.pathname = "/admin/access";
  url.search = "";
  url.hash = "";
  url.searchParams.set("bootstrap_token", token);
  return url.toString();
}

async function localBootstrapPath(): Promise<string> {
  const { getRonsRuntimePath } = await import("@/lib/rons-runtime-paths.server");
  return getRonsRuntimePath(LOCAL_BOOTSTRAP_FILE);
}

async function writeLocalBootstrapLink(token: string): Promise<void> {
  const [{ mkdir, writeFile }, { dirname }] = await Promise.all([
    import("node:fs/promises"),
    import("node:path"),
  ]);
  const path = await localBootstrapPath();
  await mkdir(dirname(path), { recursive: true });
  const url = bootstrapVerificationUrl(token, "sovereign");
  await writeFile(path, `[InternetShortcut]\r\nURL=${url}\r\n`, { encoding: "utf8" });
}
async function removeLocalBootstrapLink(): Promise<void> {
  const { unlink } = await import("node:fs/promises");
  try {
    await unlink(await localBootstrapPath());
  } catch (error) {
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? (error as { code?: unknown }).code
        : null;
    if (code !== "ENOENT") throw error;
  }
}

async function deliverBootstrapVerification({
  email,
  token,
  tokenHash,
  userId,
  provider,
}: {
  email: string;
  token: string;
  tokenHash: string;
  userId: string;
  provider: BackendProvider;
}): Promise<BootstrapDelivery> {
  if (provider === "sovereign") {
    await writeLocalBootstrapLink(token);
    return "local_file";
  }
  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) throw new Error("First-admin verification email is not configured.");
  const verificationUrl = bootstrapVerificationUrl(token, provider);
  const htmlUrl = verificationUrl.replaceAll("&", "&amp;").replaceAll('"', "&quot;");
  const messageId = crypto.randomUUID();

  const { sendLovableEmail } = await import("@lovable.dev/email-js");
  await sendLovableEmail(
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
    { apiKey, sendUrl: process.env.LOVABLE_SEND_URL },
  );
  return "email";
}
export const getAdminBootstrapStatus = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const token =
      input && typeof input === "object" && "token" in input
        ? (input as { token?: unknown }).token
        : null;
    return { token: isAdminBootstrapToken(token) ? token : null };
  })
  .handler(async ({ data }) => {
    const context = await requireRonsContext();
    const access = await loadBootstrapAccess(
      context.userId,
      context.user,
      context.authProvider,
      context.credential,
    );
    if (access.status !== "eligible") return { status: access.status };
    if (!data.token) return { status: "email_reverification_required" as const };

    const tokenHash = await hashBootstrapToken(data.token);
    if (context.authProvider === "sovereign") {
      const { checkSovereignBootstrapChallenge } = await import("@/lib/backend-provider.server");
      const valid = await checkSovereignBootstrapChallenge(
        context.credential,
        context.userId,
        tokenHash,
      );
      return { status: valid ? ("eligible" as const) : ("email_reverification_required" as const) };
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
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

export const requestAdminBootstrapVerification = createServerFn({ method: "POST" }).handler(
  async () => {
    const context = await requireRonsContext();
    const access = await loadBootstrapAccess(
      context.userId,
      context.user,
      context.authProvider,
      context.credential,
    );
    if (access.status !== "eligible") return { status: access.status };
    if (!access.canonicalEmail) return { status: "email_unverified" as const };

    const token = generateBootstrapToken();
    const tokenHash = await hashBootstrapToken(token);
    let rawChallenge: unknown;
    if (context.authProvider === "sovereign") {
      const { createSovereignBootstrapChallenge } = await import("@/lib/backend-provider.server");
      rawChallenge = await createSovereignBootstrapChallenge(
        context.credential,
        context.userId,
        access.canonicalEmail,
        tokenHash,
      );
    } else {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data, error } = await supabaseAdmin.rpc("create_admin_bootstrap_challenge", {
        _user_id: context.userId,
        _verified_email: access.canonicalEmail,
        _token_hash: tokenHash,
      });
      if (error) {
        console.error("[Admin bootstrap] Verification challenge creation failed");
        throw new Error("Unable to prepare the verification link. Please try again.");
      }
      rawChallenge = data;
    }

    const challengeResult = parseAdminBootstrapChallengeResult(rawChallenge);
    if (challengeResult === "verification_recently_sent") {
      return { status: "verification_recently_sent" as const };
    }
    if (challengeResult !== "verification_created") return { status: challengeResult };

    let delivery: BootstrapDelivery;
    try {
      delivery = await deliverBootstrapVerification({
        email: access.canonicalEmail,
        token,
        tokenHash,
        userId: context.userId,
        provider: context.authProvider,
      });
    } catch {
      try {
        if (context.authProvider === "sovereign") {
          const { cancelSovereignBootstrapChallenge } =
            await import("@/lib/backend-provider.server");
          await cancelSovereignBootstrapChallenge(context.credential, context.userId, tokenHash);
        } else {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          await supabaseAdmin.rpc("cancel_admin_bootstrap_challenge", {
            _user_id: context.userId,
            _token_hash: tokenHash,
          });
        }
      } catch {
        console.error("[Admin bootstrap] Verification challenge cleanup failed");
      }
      console.error("[Admin bootstrap] Verification delivery failed");
      throw new Error("Unable to prepare the verification link. Please try again.");
    }

    return { status: "verification_sent" as const, delivery };
  },
);

export const bootstrapAdmin = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const token =
      input && typeof input === "object" && "token" in input
        ? (input as { token?: unknown }).token
        : null;
    return { token: isAdminBootstrapToken(token) ? token : null };
  })
  .handler(async ({ data }) => {
    const context = await requireRonsContext();
    const access = await loadBootstrapAccess(
      context.userId,
      context.user,
      context.authProvider,
      context.credential,
    );
    if (access.status !== "eligible") return { status: access.status };
    if (!access.canonicalEmail) return { status: "email_unverified" as const };
    if (!data.token) return { status: "email_reverification_required" as const };

    const tokenHash = await hashBootstrapToken(data.token);
    let rawResult: unknown;
    if (context.authProvider === "sovereign") {
      const { claimSovereignFirstAdmin } = await import("@/lib/backend-provider.server");
      rawResult = await claimSovereignFirstAdmin(
        context.credential,
        context.userId,
        access.canonicalEmail,
        tokenHash,
      );
    } else {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: rpcResult, error } = await supabaseAdmin.rpc("bootstrap_first_admin", {
        _user_id: context.userId,
        _verified_email: access.canonicalEmail,
        _token_hash: tokenHash,
      });
      if (error) {
        console.error("[Admin bootstrap] Atomic claim failed");
        throw new Error("Unable to create the first admin. Please try again.");
      }
      rawResult = rpcResult;
    }

    const status = parseAdminBootstrapResult(rawResult);
    if (context.authProvider === "sovereign" && status !== "email_reverification_required") {
      await removeLocalBootstrapLink();
    }
    return { status };
  });
