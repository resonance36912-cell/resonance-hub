// Server-only push + probe helpers. Called from admin server functions and cron.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { buildSignedHeaders } from "./hmac.server";

type AppRow = {
  id: string;
  slug: string;
  origin_url: string | null;
  control_path: string;
  validate_path: string;
  control_enabled: boolean;
  signing_key_hash: string;
  status: string;
};

async function loadApp(appId: string): Promise<AppRow | null> {
  const { data } = await supabaseAdmin
    .from("hub_apps")
    .select("id, slug, origin_url, control_path, validate_path, control_enabled, signing_key_hash, status")
    .eq("id", appId)
    .maybeSingle();
  return (data as AppRow | null) ?? null;
}

async function recordDelivery(row: {
  app_id: string;
  kind: string;
  status: string;
  http_status?: number | null;
  request_body?: unknown;
  response_body?: unknown;
  error?: string | null;
  duration_ms?: number;
}) {
  await supabaseAdmin.from("hub_control_deliveries").insert({
    app_id: row.app_id,
    kind: row.kind,
    status: row.status,
    http_status: row.http_status ?? null,
    request_body: (row.request_body ?? null) as never,
    response_body: (row.response_body ?? null) as never,
    error: row.error ?? null,
    duration_ms: row.duration_ms ?? null,
  });
}

async function timedFetch(url: string, init: RequestInit, timeoutMs = 8000) {
  const start = Date.now();
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    const text = await res.text();
    let body: unknown = text;
    try { body = JSON.parse(text); } catch { /* keep text */ }
    return { ok: res.ok, status: res.status, body, ms: Date.now() - start };
  } finally {
    clearTimeout(t);
  }
}

export type PushResult = { ok: boolean; status: number | null; error?: string };

export async function pushToApp(
  appId: string,
  kind: "push_nudge" | "apply_config",
  payload: Record<string, unknown>,
): Promise<PushResult> {
  const app = await loadApp(appId);
  if (!app) return { ok: false, status: null, error: "app not found" };
  if (!app.control_enabled) return { ok: false, status: null, error: "control disabled" };
  if (!app.origin_url) return { ok: false, status: null, error: "origin_url not set" };
  if (app.status !== "active") return { ok: false, status: null, error: "app not active" };

  const url = new URL(app.control_path, app.origin_url).toString();
  const body = JSON.stringify({ kind, hub_app_id: app.id, ...payload });
  const headers = buildSignedHeaders(app.id, app.signing_key_hash, body);

  try {
    const r = await timedFetch(url, { method: "POST", headers, body });
    await recordDelivery({
      app_id: app.id,
      kind,
      status: r.ok ? "ok" : "http_error",
      http_status: r.status,
      request_body: JSON.parse(body),
      response_body: r.body,
      duration_ms: r.ms,
    });
    await supabaseAdmin
      .from("hub_apps")
      .update({ last_push_at: new Date().toISOString(), last_push_status: r.ok ? "ok" : `http_${r.status}` })
      .eq("id", app.id);
    return { ok: r.ok, status: r.status };
  } catch (e) {
    const err = (e as Error).message;
    await recordDelivery({
      app_id: app.id, kind, status: "network_error",
      request_body: JSON.parse(body), error: err,
    });
    await supabaseAdmin
      .from("hub_apps")
      .update({ last_push_at: new Date().toISOString(), last_push_status: "network_error" })
      .eq("id", app.id);
    return { ok: false, status: null, error: err };
  }
}

export async function probeApp(appId: string): Promise<PushResult & { detail?: string }> {
  const app = await loadApp(appId);
  if (!app) return { ok: false, status: null, error: "app not found" };
  if (!app.origin_url) return { ok: false, status: null, error: "origin_url not set" };

  const url = new URL(app.validate_path, app.origin_url).toString();
  const body = JSON.stringify({ hub_app_id: app.id, requested_at: new Date().toISOString() });
  const headers = buildSignedHeaders(app.id, app.signing_key_hash, body);

  try {
    const r = await timedFetch(url, { method: "POST", headers, body }, 6000);
    const status = r.ok ? "healthy" : `unhealthy_${r.status}`;
    await recordDelivery({
      app_id: app.id, kind: "probe",
      status: r.ok ? "ok" : "http_error",
      http_status: r.status, response_body: r.body, duration_ms: r.ms,
    });
    await supabaseAdmin.from("hub_apps").update({
      last_health_at: new Date().toISOString(),
      last_health_status: status,
      last_health_detail: (r.body ?? null) as never,
    }).eq("id", app.id);
    return { ok: r.ok, status: r.status, detail: typeof r.body === "string" ? r.body : JSON.stringify(r.body) };
  } catch (e) {
    const err = (e as Error).message;
    await recordDelivery({ app_id: app.id, kind: "probe", status: "network_error", error: err });
    await supabaseAdmin.from("hub_apps").update({
      last_health_at: new Date().toISOString(),
      last_health_status: "unreachable",
      last_health_detail: { error: err } as never,
    }).eq("id", app.id);
    return { ok: false, status: null, error: err };
  }
}
