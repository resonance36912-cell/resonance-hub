import type { AppStatus } from "@/lib/app-registry";

/**
 * Human-readable meaning of each registry status.
 *
 * The badge alone caused confusion ("Beta" read as "not released yet" even
 * though Sync Vision was fully deployed and purchasable). Every surface that
 * renders a status badge should also render `access` so visitors know whether
 * they can use the app today.
 */
export type AppStatusMeaning = {
  /** Badge text. */
  label: string;
  /** One-line answer to "can I use this right now?". */
  access: string;
  /** Longer sentence for tooltips, legends, and detail pages. */
  explanation: string;
  /** True when the app is usable today (everything except coming_soon). */
  accessible: boolean;
};

export const APP_STATUS_MEANING: Record<AppStatus, AppStatusMeaning> = {
  live: {
    label: "Live",
    access: "Live access",
    explanation:
      "Fully released and generally available. Sign in and use every shipped feature today.",
    accessible: true,
  },
  beta: {
    label: "Beta",
    access: "Beta badge, live access",
    explanation:
      "Deployed and open to everyone right now — the beta badge only means features are still being added and refined, not that access is restricted.",
    accessible: true,
  },
  pilot: {
    label: "Pilot",
    access: "Pilot badge, live access",
    explanation:
      "Deployed and usable today while we validate it with early users, so behaviour and pricing may still change.",
    accessible: true,
  },
  coming_soon: {
    label: "Coming soon",
    access: "Not yet available",
    explanation:
      "Announced but not deployed yet. There is nothing to sign in to — follow the roadmap for the release date.",
    accessible: false,
  },
};

/** Status legend for catalog pages, ordered most to least available. */
export const APP_STATUS_LEGEND: AppStatus[] = ["live", "beta", "pilot", "coming_soon"];

export function statusMeaning(status: AppStatus): AppStatusMeaning {
  return APP_STATUS_MEANING[status];
}
