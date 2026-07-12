import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/integrations/supabase/types";
import {
  slugify,
  validateAppUrl,
  isReservedSlug,
  isReservedHost,
  normalizeHost,
} from "@/lib/app-submission-validation";


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
  logo_path: string | null;
  screenshot_paths: string[];
  // Signed URLs (populated on public list)
  logo_url?: string | null;
  screenshot_urls?: string[];
};

const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const STORAGE_PATH = /^incoming\/[A-Za-z0-9._\-/]+\.(png|jpg|jpeg|webp|gif|svg)$/i;

const submitSchema = z.object({
  name: z.string().trim().min(2).max(80),
  url: z.string().trim().url().max(500),
  tagline: z.string().trim().min(10).max(160),
  description: z.string().trim().max(2000).optional().nullable(),
  useCase: z.string().trim().max(160).optional().nullable(),
  contactEmail: z.string().trim().email().max(320),
  accentColor: z.string().trim().regex(HEX_COLOR).optional().nullable(),
  logoPath: z.string().trim().regex(STORAGE_PATH).max(500).optional().nullable(),
  screenshotPaths: z.array(z.string().trim().regex(STORAGE_PATH).max(500)).max(6).optional().default([]),
});

const SIGNED_URL_TTL_SEC = 60 * 60 * 24 * 7; // 7 days

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

async function signPaths(paths: string[]): Promise<string[]> {
  if (paths.length === 0) return [];
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .storage
    .from("app-submissions")
    .createSignedUrls(paths, SIGNED_URL_TTL_SEC);
  if (error) return [];
  return (data ?? []).map((d) => d.signedUrl ?? "");
}

// -------- Public: submit --------

export const submitAppSubmission = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => submitSchema.parse(d))
  .handler(async ({ data }): Promise<{ id: string }> => {
    // Authoritative URL + uniqueness checks (client-side hints are advisory).
    const urlCheck = validateAppUrl(data.url);
    if (!urlCheck.ok) throw new Error(urlCheck.reason);
    const slug = slugify(data.name);
    if (slug.length < 2) throw new Error("App name must contain letters or numbers.");
    if (isReservedSlug(slug)) throw new Error(`"${slug}" is a reserved slug. Try a different name.`);
    if (isReservedHost(urlCheck.host)) throw new Error(`${urlCheck.host} is already used by a Resonance app.`);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: existing, error: dupErr } = await supabaseAdmin
      .from("app_submissions")
      .select("id,name,url,status")
      .in("status", ["pending", "approved", "published"]);
    if (dupErr) throw new Error(dupErr.message);
    for (const row of existing ?? []) {
      if (slugify(row.name) === slug) {
        throw new Error(`An app named "${row.name}" is already submitted.`);
      }
      try {
        if (normalizeHost(new URL(row.url).hostname) === urlCheck.host) {
          throw new Error(`${urlCheck.host} has already been submitted.`);
        }
      } catch {
        /* skip malformed legacy rows */
      }
    }

    const supabase = createClient<Database>(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_PUBLISHABLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const { data: row, error } = await supabase
      .from("app_submissions")
      .insert({
        name: data.name,
        url: urlCheck.normalizedUrl,
        tagline: data.tagline,
        description: data.description ?? null,
        use_case: data.useCase ?? null,
        contact_email: data.contactEmail,
        accent_color: data.accentColor ?? null,
        logo_path: data.logoPath ?? null,
        screenshot_paths: data.screenshotPaths ?? [],
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: row.id };
  });

// -------- Public: pre-submit availability check --------

const availabilitySchema = z.object({
  name: z.string().trim().max(80).optional().default(""),
  url: z.string().trim().max(500).optional().default(""),
});

export type SubmissionAvailability = {
  slug: string;
  host: string | null;
  normalizedUrl: string | null;
  urlError: string | null;
  slugTaken: boolean;
  slugReserved: boolean;
  hostTaken: boolean;
  hostReserved: boolean;
  conflictWith?: { name: string; url: string } | null;
};

export const checkSubmissionAvailability = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => availabilitySchema.parse(d))
  .handler(async ({ data }): Promise<SubmissionAvailability> => {
    const slug = slugify(data.name ?? "");
    let host: string | null = null;
    let normalizedUrl: string | null = null;
    let urlError: string | null = null;
    if (data.url && data.url.trim()) {
      const urlCheck = validateAppUrl(data.url);
      if (urlCheck.ok) {
        host = urlCheck.host;
        normalizedUrl = urlCheck.normalizedUrl;
      } else {
        urlError = urlCheck.reason;
      }
    }
    const slugReserved = slug.length >= 2 && isReservedSlug(slug);
    const hostReserved = !!host && isReservedHost(host);

    let slugTaken = false;
    let hostTaken = false;
    let conflictWith: { name: string; url: string } | null = null;

    if ((slug.length >= 2 && !slugReserved) || (host && !hostReserved)) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: rows } = await supabaseAdmin
        .from("app_submissions")
        .select("name,url,status")
        .in("status", ["pending", "approved", "published"]);
      for (const r of rows ?? []) {
        const rSlug = slugify(r.name);
        let rHost: string | null = null;
        try {
          rHost = normalizeHost(new URL(r.url).hostname);
        } catch {
          /* ignore */
        }
        if (slug.length >= 2 && rSlug === slug) {
          slugTaken = true;
          conflictWith = { name: r.name, url: r.url };
        }
        if (host && rHost === host) {
          hostTaken = true;
          conflictWith = conflictWith ?? { name: r.name, url: r.url };
        }
      }
    }

    return {
      slug,
      host,
      normalizedUrl,
      urlError,
      slugTaken,
      slugReserved,
      hostTaken,
      hostReserved,
      conflictWith,
    };
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
        "id,name,url,tagline,description,use_case,accent_color,status,review_notes,reviewed_at,published_at,created_at,updated_at,logo_path,screenshot_paths",
      )
      .eq("status", "published")
      .order("published_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as AppSubmission[];

    // Collect all paths in one signing pass
    const allPaths: string[] = [];
    for (const r of rows) {
      if (r.logo_path) allPaths.push(r.logo_path);
      for (const p of r.screenshot_paths ?? []) allPaths.push(p);
    }
    const signed = await signPaths(allPaths);
    const map = new Map<string, string>();
    let i = 0;
    for (const p of allPaths) {
      const s = signed[i++];
      if (s) map.set(p, s);
    }
    for (const r of rows) {
      r.logo_url = r.logo_path ? map.get(r.logo_path) ?? null : null;
      r.screenshot_urls = (r.screenshot_paths ?? []).map((p) => map.get(p)).filter(Boolean) as string[];
    }
    return rows;
  });

// -------- Public: status timeline by id --------

export type SubmissionStatusEvent = {
  key: "submitted" | "reviewed" | "approved" | "rejected" | "published" | "unpublished" | "updated";
  label: string;
  at: string;
  note?: string | null;
};

export type SubmissionStatusView = {
  id: string;
  name: string;
  url: string;
  status: AppSubmissionStatus;
  created_at: string;
  reviewed_at: string | null;
  published_at: string | null;
  updated_at: string;
  review_notes: string | null;
  timeline: SubmissionStatusEvent[];
};

function buildTimeline(row: {
  status: AppSubmissionStatus;
  created_at: string;
  reviewed_at: string | null;
  published_at: string | null;
  updated_at: string;
  review_notes: string | null;
}): SubmissionStatusEvent[] {
  const events: SubmissionStatusEvent[] = [
    { key: "submitted", label: "Submitted", at: row.created_at },
  ];
  if (row.reviewed_at) {
    events.push({
      key: "reviewed",
      label: "Reviewed",
      at: row.reviewed_at,
      note: row.review_notes,
    });
    if (row.status === "approved") {
      events.push({ key: "approved", label: "Approved", at: row.reviewed_at });
    } else if (row.status === "rejected") {
      events.push({ key: "rejected", label: "Rejected", at: row.reviewed_at });
    }
  }
  if (row.published_at) {
    events.push({ key: "published", label: "Published", at: row.published_at });
    if (row.status !== "published") {
      events.push({ key: "unpublished", label: "Unpublished", at: row.updated_at });
    }
  }
  // Sort chronologically, stable
  events.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  return events;
}

export function submissionTimeline(row: {
  status: AppSubmissionStatus;
  created_at: string;
  reviewed_at: string | null;
  published_at: string | null;
  updated_at: string;
  review_notes: string | null;
}): SubmissionStatusEvent[] {
  return buildTimeline(row);
}

const statusSchema = z.object({ id: z.string().uuid() });

export const getSubmissionStatus = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => statusSchema.parse(d))
  .handler(async ({ data }): Promise<SubmissionStatusView | null> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error } = await supabaseAdmin
      .from("app_submissions")
      .select("id,name,url,status,created_at,reviewed_at,published_at,updated_at,review_notes")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) return null;
    const r = row as {
      id: string;
      name: string;
      url: string;
      status: AppSubmissionStatus;
      created_at: string;
      reviewed_at: string | null;
      published_at: string | null;
      updated_at: string;
      review_notes: string | null;
    };
    return { ...r, timeline: buildTimeline(r) };
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
    const list = (rows ?? []) as AppSubmission[];
    const allPaths: string[] = [];
    for (const r of list) {
      if (r.logo_path) allPaths.push(r.logo_path);
      for (const p of r.screenshot_paths ?? []) allPaths.push(p);
    }
    const signed = await signPaths(allPaths);
    const map = new Map<string, string>();
    let i = 0;
    for (const p of allPaths) {
      const s = signed[i++];
      if (s) map.set(p, s);
    }
    for (const r of list) {
      r.logo_url = r.logo_path ? map.get(r.logo_path) ?? null : null;
      r.screenshot_urls = (r.screenshot_paths ?? []).map((p) => map.get(p)).filter(Boolean) as string[];
    }
    return list;
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
      // Best-effort: also remove any uploaded media
      const { data: row } = await supabaseAdmin
        .from("app_submissions")
        .select("logo_path,screenshot_paths")
        .eq("id", data.id)
        .maybeSingle();
      const paths = [
        ...(row?.logo_path ? [row.logo_path] : []),
        ...((row?.screenshot_paths as string[] | null) ?? []),
      ];
      if (paths.length > 0) {
        await supabaseAdmin.storage.from("app-submissions").remove(paths);
      }
      const { error } = await supabaseAdmin
        .from("app_submissions")
        .delete()
        .eq("id", data.id);
      if (error) throw new Error(error.message);
      return { ok: true };
    }

    const now = new Date().toISOString();
    const patch: Database["public"]["Tables"]["app_submissions"]["Update"] = {
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
