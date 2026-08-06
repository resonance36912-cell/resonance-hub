import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { registerExtraReturnToOrigins } from "./return-to-allowlist";
import { normalizeAdminOriginOrThrow } from "./admin-origin-validation";

/**
 * Admin-managed `return_to` allowlist entries (`public.return_to_origins`).
 *
 * - `listReturnToOrigins` is admin-gated and returns every row (enabled or not).
 * - `listEnabledReturnToOrigins` is a public read of enabled origins only; it
 *   feeds `hydrateReturnToAllowlist()` so the runtime allowlist includes the
 *   admin-managed extras.
 * - Mutations require the `admin` role in `public.user_roles`.
 *
 * The code-defined base allowlist in `return-to-allowlist.ts` is never removed
 * by these rows — admins can only widen it.
 */

export type ReturnToOrigin = {
  id: string;
  origin: string;
  label: string | null;
  notes: string | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

type Row = Record<string, unknown>;

const SELECT = "id, origin, label, notes, enabled, created_at, updated_at";

function mapRow(r: Row): ReturnToOrigin {
  return {
    id: r.id as string,
    origin: r.origin as string,
    label: (r.label as string | null) ?? null,
    notes: (r.notes as string | null) ?? null,
    enabled: Boolean(r.enabled),
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
  };
}

async function assertAdmin(context: {
  supabase: {
    rpc: (
      fn: string,
      args: Record<string, unknown>,
    ) => Promise<{ data: unknown; error: { message: string } | null }>;
  };
  userId: string;
}) {
  const { data, error } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden");
}

export const listEnabledReturnToOrigins = createServerFn({
  method: "GET",
}).handler(async (): Promise<string[]> => {
  const { createClient } = await import("@supabase/supabase-js");
  const client = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_PUBLISHABLE_KEY!,
    { auth: { persistSession: false } },
  );
  const { data, error } = await client
    .from("return_to_origins" as never)
    .select("origin" as never)
    .eq("enabled" as never, true);
  if (error) throw new Error(error.message);
  return ((data as unknown as Row[]) ?? []).map((r) => r.origin as string);
});

/** Load enabled admin-managed origins and register them on the runtime allowlist. */
export async function hydrateReturnToAllowlist(): Promise<string[]> {
  const origins = await listEnabledReturnToOrigins();
  return registerExtraReturnToOrigins(origins);
}

export const listReturnToOrigins = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ReturnToOrigin[]> => {
    await assertAdmin(context as never);
    const { data, error } = await context.supabase
      .from("return_to_origins" as never)
      .select(SELECT)
      .order("created_at" as never, { ascending: false });
    if (error) throw new Error(error.message);
    return ((data as unknown as Row[]) ?? []).map(mapRow);
  });

const upsertSchema = z.object({
  id: z.string().uuid().optional(),
  origin: z.string().trim().min(4).max(300),
  label: z.string().trim().max(120).nullable().optional(),
  notes: z.string().trim().max(500).nullable().optional(),
  enabled: z.boolean().optional(),
});

export const upsertReturnToOrigin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => upsertSchema.parse(raw))
  .handler(async ({ data, context }): Promise<ReturnToOrigin> => {
    await assertAdmin(context as never);
    const origin = normalizeAdminOriginOrThrow(data.origin);
    const row: Record<string, unknown> = {
      origin,
      label: data.label ?? null,
      notes: data.notes ?? null,
      enabled: data.enabled ?? true,
      created_by: context.userId,
    };
    if (data.id) row.id = data.id;

    const { data: out, error } = await context.supabase
      .from("return_to_origins" as never)
      .upsert(row as never, { onConflict: "origin" })
      .select(SELECT)
      .single();
    if (error) throw new Error(error.message);
    return mapRow(out as unknown as Row);
  });

export const setReturnToOriginEnabled = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) =>
    z.object({ id: z.string().uuid(), enabled: z.boolean() }).parse(raw),
  )
  .handler(async ({ data, context }): Promise<ReturnToOrigin> => {
    await assertAdmin(context as never);
    const { data: out, error } = await context.supabase
      .from("return_to_origins" as never)
      .update({ enabled: data.enabled } as never)
      .eq("id" as never, data.id)
      .select(SELECT)
      .single();
    if (error) throw new Error(error.message);
    return mapRow(out as unknown as Row);
  });

export const deleteReturnToOrigin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) =>
    z.object({ id: z.string().uuid() }).parse(raw),
  )
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    await assertAdmin(context as never);
    const { error } = await context.supabase
      .from("return_to_origins" as never)
      .delete()
      .eq("id" as never, data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
