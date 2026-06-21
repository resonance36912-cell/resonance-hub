import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function assertAdmin(context: { supabase: any; userId: string }) {
  const { data, error } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (error || !data) throw new Error("Forbidden");
}

// ─── List apps ────────────────────────────────────────────────────────────────
export const listHubApps = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("hub_apps")
      .select("id, slug, name, public_url, status, signing_key_prefix, last_seen_at, created_at")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return { apps: data ?? [] };
  });

// ─── Register app (mints raw signing key, returned ONCE) ──────────────────────
const RegisterInput = z.object({
  slug: z.string().min(2).max(60).regex(/^[a-z0-9_-]+$/),
  name: z.string().min(1).max(120),
  public_url: z.string().url().optional().or(z.literal("")),
});

export const registerHubApp = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => RegisterInput.parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { mintSigningKey, hashSigningKey } = await import("@/lib/rop/hmac.server");
    const minted = mintSigningKey();
    const { data: row, error } = await supabaseAdmin
      .from("hub_apps")
      .insert({
        slug: data.slug,
        name: data.name,
        public_url: data.public_url || null,
        signing_key_hash: minted.hash,
        signing_key_prefix: minted.prefix,
        created_by: context.userId,
      })
      .select("id, slug, name, public_url, status, signing_key_prefix, created_at")
      .single();
    if (error) throw new Error(error.message);
    await supabaseAdmin.from("hub_audit_events").insert({
      app_id: row.id,
      kind: "app.registered",
      payload: { slug: data.slug } as any,
      actor_user_id: context.userId,
    });
    // We hand back the raw key AND its sha256 hash. The app uses the sha256
    // hex as the HMAC secret (see hmac.server.ts for the rationale).
    return {
      app: row,
      raw_signing_key: minted.raw,
      hmac_secret: hashSigningKey(minted.raw),
    };
  });

// ─── Rotate signing key ───────────────────────────────────────────────────────
const IdInput = z.object({ id: z.string().uuid() });

export const rotateHubAppKey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => IdInput.parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { mintSigningKey, hashSigningKey } = await import("@/lib/rop/hmac.server");
    const minted = mintSigningKey();
    const { error } = await supabaseAdmin
      .from("hub_apps")
      .update({ signing_key_hash: minted.hash, signing_key_prefix: minted.prefix })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    await supabaseAdmin.from("hub_audit_events").insert({
      app_id: data.id,
      kind: "app.key_rotated",
      payload: {} as any,
      actor_user_id: context.userId,
    });
    return { raw_signing_key: minted.raw, hmac_secret: hashSigningKey(minted.raw) };
  });

// ─── Set status ───────────────────────────────────────────────────────────────
const StatusInput = z.object({
  id: z.string().uuid(),
  status: z.enum(["active", "paused", "revoked"]),
});

export const setHubAppStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => StatusInput.parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("hub_apps")
      .update({ status: data.status })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ─── Suggestions list / approve / broadcast ───────────────────────────────────
export const listHubSuggestions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("hub_suggestions")
      .select("*")
      .order("updated_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    return { suggestions: data ?? [] };
  });

const SuggestionPatch = z.object({
  id: z.string().uuid(),
  status: z.enum(["pending", "approved", "applied", "reverted", "rejected"]).optional(),
  broadcast: z.boolean().optional(),
});

export const updateHubSuggestion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => SuggestionPatch.parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const patch: Record<string, unknown> = {};
    if (data.status !== undefined) patch.status = data.status;
    if (data.broadcast !== undefined) patch.broadcast = data.broadcast;
    const { error } = await supabaseAdmin.from("hub_suggestions").update(patch).eq("id", data.id);
    if (error) throw new Error(error.message);
    await supabaseAdmin.from("hub_audit_events").insert({
      kind: "suggestion.admin_update",
      payload: { id: data.id, patch } as any,
      actor_user_id: context.userId,
    });
    return { ok: true };
  });

// ─── Recent perf summary ──────────────────────────────────────────────────────
export const getHubPerfSummary = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await supabaseAdmin
      .from("hub_perf_events")
      .select("app_id, step, duration_ms, status, occurred_at")
      .gt("occurred_at", since)
      .order("occurred_at", { ascending: false })
      .limit(2000);
    if (error) throw new Error(error.message);
    return { events: data ?? [] };
  });

// ─── Outcomes ─────────────────────────────────────────────────────────────────
export const listHubOutcomes = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("hub_outcomes")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    return { outcomes: data ?? [] };
  });
