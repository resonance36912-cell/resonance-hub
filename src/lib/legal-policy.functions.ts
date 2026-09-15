/**
 * Public read of the currently active privacy policy version.
 *
 * Uses the server publishable client — the `privacy_policy_versions` table
 * has a `TO anon SELECT` RLS policy, so this is safe to render during SSR
 * on public /legal/* routes without a user session.
 */
import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export type ActivePolicy = {
  version: string;
  effective_at: string;
  summary: string;
  url: string;
} | null;

export const getActivePolicy = createServerFn({ method: "GET" }).handler(
  async (): Promise<ActivePolicy> => {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_PUBLISHABLE_KEY;

    // Public legal pages must remain renderable in sovereign/offline and CI
    // environments where the optional Supabase policy store is not configured.
    if (!url || !key) return null;
    const supabase = createClient<Database>(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        fetch: (input, init) => {
          const h = new Headers(init?.headers);
          if (key.startsWith("sb_") && h.get("Authorization") === `Bearer ${key}`) {
            h.delete("Authorization");
          }
          h.set("apikey", key);
          return fetch(input, { ...init, headers: h });
        },
      },
    });
    const { data, error } = await supabase
      .from("privacy_policy_versions")
      .select("version, effective_at, summary, url")
      .order("effective_at", { ascending: false })
      .limit(1);
    if (error) throw new Error(error.message);
    return (data?.[0] ?? null) as ActivePolicy;
  },
);
