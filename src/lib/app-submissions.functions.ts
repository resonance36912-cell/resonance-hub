import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/integrations/supabase/types";

// -----------------------------------------------------------------------------
// App submissions — public submit + admin review workflow
// -----------------------------------------------------------------------------

export type AppSubmissionStatus = "pending" | "approved" | "rejected" | "published";

export type AppSubmission = {
  id: string;
  name: string;
  url: string;
  tagline: string;
  description: string | null;
  use_case: string | null;
  contact_email: string;
  accent_color: string | null;
  submitter_user_id: string | null;
  status: AppSubmissionStatus;
  review_notes: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  published_at: string | null;
  created_at: string;
  updated_at: string;
};

const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

const submitSchema = z.object({
  name: z.string().trim().min(2).max(80),
  url: z.string().trim().url().max(500),
  tagline: z.string().trim().min(10).max(160),
  description: z.string().trim().max(2000).optional().nullable(),
  useCase: z.string().trim().max(160).optional().nullable(),
  contactEmail: z.string().trim().email().max(320),
  accentColor: z.string().trim().regex(HEX_COLOR).optional().nullable(),
});

async function assertAdmin(userId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden: admin role required");
  return supabaseAdmin;
}

// -------- Public: submit --------

export const submitAppSubmission = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => submitSchema.parse(d))
  .handler(async ({ data }): Promise<{ id: string }> => {
    // Use publishable client so the anon INSERT policy applies.
    const supabase = createClient<Database>(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_PUBLISHABLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const { data: row, error } = await supabase
      .from("app_submissions")
      .insert({
        name: data.name,
        url: data.url,
        tagline: data.tagline,
        description: data.description ?? null,
        use_case: data.useCase ?? null,
        contact_email: data.contactEmail,
        accent_color: data.accentColor ?? null,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: row.id };
  });

// -------- Public: list published --------

export const listPublishedSubmissions = createServerFn({ method: "GET" })
  .handler(async (): Promise<AppSubmission[]> => {
    const supabase = createClient<Database>(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_PUBLISHABLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const { data, error } = await supabase
      .from("app_submissions")
      .select(
        "id,name,url,tagline,description,use_case,contact_email,accent_color,submitter_user_id,status,review_notes,reviewed_by,reviewed_at,published_at,created_at,updated_at",
      )
      .eq("status", "published")
      .order("published_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    return (data ?? []) as AppSubmission[];
  });

// -------- Admin: list --------

const listSchema = z.object({
  status: z.enum(["pending", "approved", "rejected", "published", "all"]).default("pending"),
  limit: z.number().int().min(1).max(200).default(100),
});

export const listAppSubmissions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => listSchema.parse(d ?? {}))
  .handler(async ({ data, context }): Promise<AppSubmission[]> => {
    const supabaseAdmin = await assertAdmin(context.userId);
    let q = supabaseAdmin
      .from("app_submissions")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(data.limit);
    if (data.status !== "all") q = q.eq("status", data.status);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return (rows ?? []) as AppSubmission[];
  });

// -------- Admin: review (approve / reject / publish / unpublish) --------

const reviewSchema = z.object({
  id: z.string().uuid(),
  action: z.enum(["approve", "reject", "publish", "unpublish", "delete"]),
  notes: z.string().trim().max(1000).optional().nullable(),
});

export const reviewAppSubmission = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => reviewSchema.parse(d))
  .handler(async ({ data, context }): Promise<{ ok: true; submission?: AppSubmission }> => {
    const supabaseAdmin = await assertAdmin(context.userId);

    if (data.action === "delete") {
      const { error } = await supabaseAdmin
        .from("app_submissions")
        .delete()
        .eq("id", data.id);
      if (error) throw new Error(error.message);
      return { ok: true };
    }

    const now = new Date().toISOString();
    const patch: Partial<AppSubmission> = {
      reviewed_by: context.userId,
      reviewed_at: now,
      review_notes: data.notes ?? null,
    };
    if (data.action === "approve") patch.status = "approved";
    if (data.action === "reject") patch.status = "rejected";
    if (data.action === "publish") {
      patch.status = "published";
      patch.published_at = now;
    }
    if (data.action === "unpublish") {
      patch.status = "approved";
      patch.published_at = null;
    }

    const { data: row, error } = await supabaseAdmin
      .from("app_submissions")
      .update(patch)
      .eq("id", data.id)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return { ok: true, submission: row as AppSubmission };
  });
