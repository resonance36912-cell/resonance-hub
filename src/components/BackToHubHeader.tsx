import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

/**
 * Shared header link back to the Resonance Hub root ("/").
 *
 * Every user-facing spoke/account/legal page in this repo must expose a
 * working "Back to Hub" link (enforced by scripts/verify-back-to-hub.ts).
 * Import and render this component in the page header instead of hand-rolling
 * the link so the label and target stay consistent across the ecosystem.
 *
 * The literal string "Back to Hub" and `to="/"` MUST appear in this file so
 * the verifier's static check recognises files that render this component.
 *
 * Usage:
 *   <BackToHubHeader extra={<Link to="/account/billing">Billing</Link>} />
 */
export function BackToHubHeader({
  className = "flex gap-3 text-sm",
  linkClassName = "text-primary underline",
  extra,
}: {
  className?: string;
  linkClassName?: string;
  extra?: ReactNode;
}) {
  return (
    <nav className={className} aria-label="Hub navigation">
      <Link to="/" className={linkClassName}>Back to Hub</Link>
      {extra}
    </nav>
  );
}
