import { useEffect } from "react";
import type { ReturnToDiagnostic } from "@/lib/return-to-diagnostics";
import { AppLink } from "@/components/AppLink";
import { ROUTES } from "@/lib/routes";

/**
 * Visible debug notice shown on /checkout/success and /checkout/cancel when a
 * `return_to` was supplied but refused, explaining which allowlist rejected it
 * (built-in Hub/spoke list vs admin-managed list) and which origin was
 * received. Only the origin is displayed — never the full URL.
 *
 * Renders nothing when no `return_to` was supplied or when it was accepted.
 */
export function ReturnToRejectedNotice({
  diagnostic,
  surface,
}: {
  diagnostic: ReturnToDiagnostic;
  surface: string;
}) {
  const { rejected, headline, detail, origin, verdict } = diagnostic;

  useEffect(() => {
    if (!rejected) return;
    // Mirror the server-side warning into the browser console so the reason is
    // visible from either side of hydration.
    console.warn(
      `[return_to] REJECTED on ${surface}: ${headline} — ` +
        `origin=${origin ?? "<unparseable>"} code=${verdict.code}. ${detail}`,
    );
  }, [rejected, surface, headline, origin, verdict.code, detail]);

  if (!rejected) return null;

  return (
    <div
      role="status"
      data-testid="return-to-rejected-notice"
      className="mt-6 w-full max-w-xl rounded-2xl border border-amber-400/30 bg-amber-400/10 px-5 py-4 text-left text-sm"
    >
      <p className="font-bold">Return link ignored — {headline}</p>
      <p className="mt-1 opacity-80">{detail}</p>
      <dl className="mt-3 grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 font-mono text-xs opacity-70">
        <dt>origin</dt>
        <dd data-testid="return-to-rejected-origin">
          {origin ?? "<unparseable>"}
        </dd>
        <dt>reason</dt>
        <dd data-testid="return-to-rejected-code">{verdict.code}</dd>
        <dt>built-in list</dt>
        <dd>
          {diagnostic.baseAllowlistCount} origins —{" "}
          {diagnostic.matchedBaseAllowlist ? "matched" : "no match"}
        </dd>
        <dt>admin list</dt>
        <dd>
          {diagnostic.adminAllowlistCount} origins —{" "}
          {diagnostic.matchedAdminAllowlist ? "matched" : "no match"}
        </dd>
      </dl>
      <p className="mt-3 text-xs opacity-70">
        Admins can add this origin on{" "}
        <AppLink to={ROUTES.adminReturnToAllowlist} className="underline">
          the return_to allowlist page
        </AppLink>
        .
      </p>
    </div>
  );
}
