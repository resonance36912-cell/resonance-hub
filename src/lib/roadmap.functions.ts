import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

/**
 * Roadmap items — canonical DB-backed source for the homepage
 * "What's coming next" section (Phase 7).
 *
 * - `listRoadmapItems` is a public read via the publishable client.
 * - `upsertRoadmapItem` / `deleteRoadmapItem` are admin-gated: the caller
 *   must be signed in AND own the `admin` role in `public.user_roles`.
 */

export const ROADMAP_STATUSES = [
  "live",
  "rolling_out",
  "in_development",
  "planned",
  "delayed",
  "paused",
] as const;

export type RoadmapStatus = (typeof ROADMAP_STATUSES)[number];

export type RoadmapItem = {
  id: string;
  title: string;
  description: string;
  status: RoadmapStatus;
  publicNote: string | null;
  sortOrder: number;
  updatedAt: string;
};

type Row = Record<string, unknown>;

function mapRow(r: Row): RoadmapItem {
  return {
    id: r.id as string,
    title: r.title as string,
    description: r.description as string,
    status: r.status as RoadmapStatus,
    publicNote: (r.public_note as string | null) ?? null,
    sortOrder: (r.sort_order as number) ?? 100,
    updatedAt: r.updated_at as string,
  };
}

const SELECT = "id, title, description, status, public_note, sort_order, updated_at";

export const listRoadmapItems = createServerFn({ method: "GET" }).handler(
  async (): Promise<RoadmapItem[]> => {
    const { createClient } = await import("@supabase/supabase-js");
    const client = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_PUBLISHABLE_KEY!,
      { auth: { persistSession: false } },
    );
    const { data, error } = await client
      .from("roadmap_items" as never)
      .select(SELECT)
      .order("sort_order" as never, { ascending: true });
    if (error) throw new Error(error.message);
    return ((data as unknown as Row[]) ?? []).map(mapRow);
  },
);

const upsertSchema = z.object({
  id: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .regex(/^[a-z0-9-]+$/, "id must be lowercase, alphanumeric or hyphens"),
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().min(1).max(500),
  status: z.enum(ROADMAP_STATUSES),
  publicNote: z.string().trim().max(500).nullable().optional(),
  sortOrder: z.number().int().min(0).max(9999).optional(),
});

async function assertAdmin(context: {
  supabase: Awaited<ReturnType<typeof requireSupabaseAuth.client>>["context"]["supabase"];
  userId: string;
}) {
  const { data, error } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden");
}

export const upsertRoadmapItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => upsertSchema.parse(raw))
  .handler(async ({ data, context }): Promise<RoadmapItem> => {
    await assertAdmin(context as never);
    const row = {
      id: data.id,
      title: data.title,
      description: data.description,
      status: data.status,
      public_note: data.publicNote ?? null,
      sort_order: data.sortOrder ?? 100,
      updated_at: new Date().toISOString(),
    };
    const { data: out, error } = await context.supabase
      .from("roadmap_items" as never)
      .upsert(row as never, { onConflict: "id" })
      .select(SELECT)
      .single();
    if (error) throw new Error(error.message);
    return mapRow(out as unknown as Row);
  });

export const deleteRoadmapItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => z.object({ id: z.string().min(1) }).parse(raw))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    await assertAdmin(context as never);
    const { error } = await context.supabase
      .from("roadmap_items" as never)
      .delete()
      .eq("id" as never, data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
