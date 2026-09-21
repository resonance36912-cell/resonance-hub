/**
 * Hub-owned proxy for Creative Studio's paid "poster" generator.
 *
 * Why this lives in the hub (not the spoke):
 *   - The Resonance compliance brief (docs/spoke-payment-gate-brief.md)
 *     requires every paid workflow to run `requireTier(...)` server-side
 *     before any paid model call.
 *   - Creative Studio is a client-only React Router DOM app with no server
 *     functions of its own, so the hub owns the gated boundary instead.
 *
 * Contract for the spoke:
 *   POST https://reson8.life/api/public/generate/creative-studio/poster
 *     Authorization: Bearer <supabase_access_token>   // hub Supabase JWT
 *     Content-Type:  application/json
 *     Body: {
 *       prompt:      string (1..2000),
 *       aspectRatio: "1:1" | "4:5" | "9:16" | "16:9",
 *       style?:      string (max 60),
 *       returnTo?:   string  // absolute URL to bounce user back to post-checkout
 *     }
 *
 *   Responses:
 *     200 -> { ok: true, app: "creative_studio", tier, image: { mimeType, base64 } }
 *     400 -> { error: "invalid_input", issues }
 *     401 -> { error: "unauthorized", message }            // no/invalid JWT
 *     402 -> { error: "upgrade_required", ... }            // canonical upgrade body
 *     429 -> { error: "rate_limited" } | { error: "credits_exhausted" }
 *     500 -> { error: "generation_failed" }
 *
 * The handler NEVER calls the AI gateway until `requireTier` resolves.
 */

import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { requireTierFromRequest } from "@/lib/requireTier-request";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400",
} as const;

const JSON_HEADERS = {
  "Content-Type": "application/json",
  ...CORS,
} as const;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

const BodySchema = z.object({
  prompt: z.string().min(1).max(2000),
  aspectRatio: z.enum(["1:1", "4:5", "9:16", "16:9"]),
  style: z.string().max(60).optional(),
  returnTo: z.string().url().optional(),
});

// Creative Studio's paid "poster" workflow gates at the `creator` tier.
// (See docs/spoke-app-registry.md -> creative_studio.)
const APP = "creative_studio" as const;
const REQUIRED_TIER = "creator" as const;
const LOCAL_IMAGE_SERVICE = "http://127.0.0.1:7865/v1/images/generate";

export const Route = createFileRoute("/api/public/generate/creative-studio/poster")({
  server: {
    handlers: {
      OPTIONS: async () =>
        new Response(null, { status: 204, headers: CORS }),

      POST: async ({ request }) => {
        // 1. Parse + validate body BEFORE the gate so we 400 cheaply on
        //    malformed input without touching the entitlement DB.
        let parsed: z.infer<typeof BodySchema>;
        try {
          const raw = await request.json();
          const result = BodySchema.safeParse(raw);
          if (!result.success) {
            return json({ error: "invalid_input", issues: result.error.flatten() }, 400);
          }
          parsed = result.data;
        } catch {
          return json({ error: "invalid_input", message: "Body must be JSON" }, 400);
        }

        // 2. Tier gate. Throws a Response on 401/402 -- we catch and return it
        //    verbatim so the spoke gets the canonical upgrade body shape.
        let gate;
        try {
          gate = await requireTierFromRequest({
            request,
            app: APP,
            required: REQUIRED_TIER,
            returnTo: parsed.returnTo ?? "https://creative.reson8.life/generate/poster",
            responseHeaders: CORS,
          });
        } catch (err) {
          if (err instanceof Response) return err;
          console.error("[creative-studio/poster] gate failed:", err);
          return json({ error: "gate_failure" }, 500);
        }

        // 3. Only now do we call the sovereign loopback image service.
        //    The provider is local to Ealiophin, so this workflow consumes no
        //    Lovable gateway credits and does not send the prompt to a middleman.
        const stylePrefix = parsed.style ? `${parsed.style} style. ` : "";
        const aspectHint = `Aspect ratio ${parsed.aspectRatio}.`;
        const fullPrompt = `${stylePrefix}${parsed.prompt}. ${aspectHint}`;
        const orientation =
          parsed.aspectRatio === "1:1"
            ? "square"
            : parsed.aspectRatio === "16:9"
              ? "landscape"
              : "portrait";

        let imageRes: Response;
        try {
          // LOCAL_IMAGE_SERVICE is the fixed loopback image service, not a remote HTTP endpoint.
          // nosemgrep: typescript.react.security.react-insecure-request.react-insecure-request
          imageRes = await fetch(LOCAL_IMAGE_SERVICE, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              prompt: fullPrompt,
              aspectRatio: parsed.aspectRatio,
              orientation,
            }),
            signal: AbortSignal.timeout(240_000),
          });
        } catch (err) {
          console.error("[creative-studio/poster] local image service unavailable:", err);
          return json({ error: "generation_failed", provider: "rons-local" }, 502);
        }

        if (imageRes.status === 503) {
          return json(
            { error: "rate_limited", message: "Local image service is busy. Try again shortly." },
            429,
          );
        }
        if (!imageRes.ok) {
          const detail = await imageRes.text().catch(() => "");
          console.error("[creative-studio/poster] local image error", imageRes.status, detail);
          return json({ error: "generation_failed", provider: "rons-local" }, 502);
        }

        type LocalImageResponse = {
          ok?: boolean;
          provider?: string;
          model?: string;
          seed?: number;
          width?: number;
          height?: number;
          imageUrl?: string;
          error?: string;
        };
        const payload = (await imageRes.json().catch(() => null)) as LocalImageResponse | null;
        const dataUrl = payload?.imageUrl ?? null;
        if (!dataUrl || !dataUrl.startsWith("data:image/")) {
          console.error("[creative-studio/poster] no image in local service response");
          return json({ error: "generation_failed", provider: "rons-local" }, 502);
        }

        const commaIdx = dataUrl.indexOf(",");
        if (commaIdx < 6) {
          return json({ error: "generation_failed", provider: "rons-local" }, 502);
        }
        const meta = dataUrl.slice(5, commaIdx);
        const base64 = dataUrl.slice(commaIdx + 1);
        const mimeType = meta.split(";")[0] || "image/png";

        return json({
          ok: true,
          app: APP,
          tier: gate.tier,
          aspectRatio: parsed.aspectRatio,
          provider: payload?.provider ?? "rons-local",
          model: payload?.model ?? "local-image",
          seed: payload?.seed ?? null,
          width: payload?.width ?? null,
          height: payload?.height ?? null,
          image: { mimeType, base64 },
        });
      },
    },
  },
});
