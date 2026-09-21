export type AdminBootstrapStatus =
  | "eligible"
  | "already_admin"
  | "closed"
  | "email_unverified"
  | "email_reverification_required"
  | "not_allowed";

export type AdminBootstrapResult =
  | AdminBootstrapStatus
  | "bootstrapped"
  | "verification_sent"
  | "verification_recently_sent";

export type AdminBootstrapDatabaseResult =
  | "bootstrapped"
  | "already_admin"
  | "closed"
  | "email_unverified"
  | "email_reverification_required";

export type AdminBootstrapChallengeDatabaseResult =
  | "verification_created"
  | "verification_recently_sent"
  | "already_admin"
  | "closed"
  | "email_unverified";

export type AdminBootstrapFacts = {
  email: string | null | undefined;
  emailConfirmedAt: string | null | undefined;
  isAdmin: boolean;
  adminExists: boolean;
  bootstrapClaimed: boolean;
  allowlistRaw: string | null | undefined;
};

const normalizeEmail = (email: string) => email.trim().toLowerCase();

/** A 32-byte random value encoded as unpadded base64url. */
export function isAdminBootstrapToken(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);
}

/**
 * Evaluate the current user's bootstrap eligibility without ever returning the
 * configured allowlist (or distinguishing a missing list from a non-match).
 */
export function determineAdminBootstrapStatus({
  email,
  emailConfirmedAt,
  isAdmin,
  adminExists,
  bootstrapClaimed,
  allowlistRaw,
}: AdminBootstrapFacts): AdminBootstrapStatus {
  if (isAdmin) return "already_admin";
  if (adminExists || bootstrapClaimed) return "closed";
  if (!emailConfirmedAt) return "email_unverified";
  if (!email) return "not_allowed";

  const normalizedEmail = normalizeEmail(email);
  const isAllowlisted = (allowlistRaw ?? "")
    .split(",")
    .map(normalizeEmail)
    .filter(Boolean)
    .some((allowedEmail) => allowedEmail === normalizedEmail);

  return isAllowlisted ? "eligible" : "not_allowed";
}

const DATABASE_RESULTS = new Set<AdminBootstrapDatabaseResult>([
  "bootstrapped",
  "already_admin",
  "closed",
  "email_unverified",
  "email_reverification_required",
]);

const CHALLENGE_DATABASE_RESULTS = new Set<AdminBootstrapChallengeDatabaseResult>([
  "verification_created",
  "verification_recently_sent",
  "already_admin",
  "closed",
  "email_unverified",
]);

/** Fail closed if the database ever returns an outcome the application does not understand. */
export function parseAdminBootstrapResult(value: unknown): AdminBootstrapDatabaseResult {
  if (typeof value === "string" && DATABASE_RESULTS.has(value as AdminBootstrapDatabaseResult)) {
    return value as AdminBootstrapDatabaseResult;
  }
  throw new Error("Unexpected first-admin bootstrap result");
}

/** Fail closed if challenge creation returns an unknown database outcome. */
export function parseAdminBootstrapChallengeResult(
  value: unknown,
): AdminBootstrapChallengeDatabaseResult {
  if (
    typeof value === "string" &&
    CHALLENGE_DATABASE_RESULTS.has(value as AdminBootstrapChallengeDatabaseResult)
  ) {
    return value as AdminBootstrapChallengeDatabaseResult;
  }
  throw new Error("Unexpected first-admin verification result");
}
