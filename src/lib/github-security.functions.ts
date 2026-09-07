import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireRonsAuth } from "@/lib/rons-auth-middleware";
import { hasBackendRole } from "@/lib/backend-provider.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const GATEWAY_URL = "https://connector-gateway.lovable.dev/github";

export type AlertSeverity =
  | "critical"
  | "high"
  | "medium"
  | "low"
  | "warning"
  | "note"
  | "error"
  | "unknown";

export interface SecurityAlert {
  number: number;
  html_url: string;
  state: string;
  severity: AlertSeverity;
  rule_id: string;
  rule_name: string;
  rule_description: string;
  tool: string;
  path?: string | null;
  ref?: string | null;
  created_at: string;
  updated_at: string;
  most_recent_instance_message?: string | null;
}

export interface RepoSecurityScan {
  repo: string;
  html_url: string;
  error?: string;
  totals: {
    open: number;
    critical: number;
    high: number;
    medium: number;
    low: number;
    other: number;
  };
  alerts: SecurityAlert[];
  fetched_at: string;
}

export interface SecurityScanReport {
  repos: RepoSecurityScan[];
  fetched_at: string;
}

interface RawAlert {
  number: number;
  html_url: string;
  state: string;
  created_at: string;
  updated_at: string;
  rule?: {
    id?: string;
    name?: string;
    description?: string;
    severity?: string;
    security_severity_level?: string;
  } | null;
  tool?: { name?: string } | null;
  most_recent_instance?: {
    ref?: string | null;
    location?: { path?: string | null } | null;
    message?: { text?: string | null } | null;
  } | null;
}

function normalizeSeverity(raw: RawAlert): AlertSeverity {
  const sev = (raw.rule?.security_severity_level ?? raw.rule?.severity ?? "")
    .toString()
    .toLowerCase();
  if (sev === "critical") return "critical";
  if (sev === "high" || sev === "error") return "high";
  if (sev === "medium" || sev === "warning") return "medium";
  if (sev === "low" || sev === "note") return "low";
  return "unknown";
}

async function ghFetch(path: string, lovableKey: string, ghKey: string) {
  const res = await fetch(`${GATEWAY_URL}${path}`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${lovableKey}`,
      "X-Connection-Api-Key": ghKey,
    },
  });
  const text = await res.text();
  if (!res.ok) {
    return { ok: false as const, status: res.status, body: text.slice(0, 500) };
  }
  try {
    return { ok: true as const, data: JSON.parse(text) };
  } catch {
    return { ok: false as const, status: res.status, body: "invalid_json" };
  }
}

async function fetchAlertsForRepo(
  repo: string,
  lovableKey: string,
  ghKey: string,
): Promise<RepoSecurityScan> {
  const html_url = `https://github.com/${repo}`;
  const empty = {
    open: 0,
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    other: 0,
  };

  const res = await ghFetch(
    `/repos/${repo}/code-scanning/alerts?state=open&per_page=100`,
    lovableKey,
    ghKey,
  );

  if (!res.ok) {
    let error = `GitHub ${res.status}`;
    if (res.status === 404)
      error = "Code scanning not enabled or repo not accessible.";
    else if (res.status === 403)
      error = "Forbidden — token needs code_scanning:read / security_events.";
    else if (res.status === 401) error = "Unauthorized — reconnect GitHub.";
    return {
      repo,
      html_url,
      error,
      totals: empty,
      alerts: [],
      fetched_at: new Date().toISOString(),
    };
  }

  const raw = res.data as RawAlert[];
  const alerts: SecurityAlert[] = raw.map((a) => ({
    number: a.number,
    html_url: a.html_url,
    state: a.state,
    severity: normalizeSeverity(a),
    rule_id: a.rule?.id ?? "",
    rule_name: a.rule?.name ?? a.rule?.id ?? "unknown",
    rule_description: a.rule?.description ?? "",
    tool: a.tool?.name ?? "code-scanning",
    path: a.most_recent_instance?.location?.path ?? null,
    ref: a.most_recent_instance?.ref ?? null,
    created_at: a.created_at,
    updated_at: a.updated_at,
    most_recent_instance_message:
      a.most_recent_instance?.message?.text ?? null,
  }));

  const totals = { ...empty };
  for (const a of alerts) {
    totals.open += 1;
    if (a.severity === "critical") totals.critical += 1;
    else if (a.severity === "high") totals.high += 1;
    else if (a.severity === "medium") totals.medium += 1;
    else if (a.severity === "low") totals.low += 1;
    else totals.other += 1;
  }

  const sevRank: Record<AlertSeverity, number> = {
    critical: 0,
    high: 1,
    error: 1,
    medium: 2,
    warning: 2,
    low: 3,
    note: 3,
    unknown: 4,
  };
  alerts.sort((a, b) => {
    const r = sevRank[a.severity] - sevRank[b.severity];
    if (r !== 0) return r;
    return Date.parse(b.updated_at) - Date.parse(a.updated_at);
  });

  return {
    repo,
    html_url,
    totals,
    alerts,
    fetched_at: new Date().toISOString(),
  };
}

const Input = z.object({
  repos: z
    .array(z.string().regex(/^[\w.-]+\/[\w.-]+$/))
    .min(1)
    .max(10),
});

export const getSecurityScanReport = createServerFn({ method: "POST" })
  .middleware([requireRonsAuth])
  .validator((input) => Input.parse(input))
  .handler(async ({ data, context }): Promise<SecurityScanReport> => {
    if (!(await hasBackendRole(context.userId, "admin", supabaseAdmin))) {
      throw new Error("Forbidden");
    }

    const lovableKey = process.env.LOVABLE_API_KEY;
    const ghKey = process.env.GITHUB_API_KEY;
    if (!lovableKey || !ghKey) {
      throw new Error("Missing LOVABLE_API_KEY or GITHUB_API_KEY.");
    }

    const results = await Promise.all(
      data.repos.map((r) => fetchAlertsForRepo(r, lovableKey, ghKey)),
    );

    return { repos: results, fetched_at: new Date().toISOString() };
  });
