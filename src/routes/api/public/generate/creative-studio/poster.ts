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
 *     200 â†’ { ok: true, app: "creative_studio", tier, image: { mimeType, base64 } }
 *     400 â†’ { error: "invalid_input", issues }
 *     401 â†’ { error: "unauthorized", message }            // no/invalid JWT
 *     402 â†’ { error: "upgrade_required", ... }            // canonical upgrade body
 *     429 â†’ { error: "rate_limited" } | { error: "credits_exhausted" }
 *     500 â†’ { error: "generation_failed" }
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
// (See docs/spoke-app-registry.md â†’ creative_studio.)
const APP = "creative_studio" as const;
const REQUIRED_TIER = "creator" as const;

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

        // 2. Tier gate. Throws a Response on 401/402 â€” we catch and return it
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

        // 3. Only now do we call the paid model. Anything that costs money
        //    or burns AI gateway credits must live below this line.
        const LOVABLE_API_KEY = process.env.LOVABLE_API_KEY;
        if (!LOVABLE_API_KEY) {
          console.error("[creative-studio/poster] LOVABLE_API_KEY missing");
          return json({ error: "server_misconfigured" }, 500);
        }

        const stylePrefix = parsed.style ? `${parsed.style} style. ` : "";
        const aspectHint = `Aspect ratio ${parsed.aspectRatio}.`;
        const fullPrompt = `${stylePrefix}${parsed.prompt}. ${aspectHint}`;

        let aiRes: Response;
        try {
          aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${LOVABLE_API_KEY}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: "google/gemini-2.5-flash-image",
              messages: [{ role: "user", content: fullPrompt }],
              modalities: ["image", "text"],
            }),
          });
        } catch (err) {
          console.error("[creative-studio/poster] gateway fetch failed:", err);
          return json({ error: "generation_failed" }, 502);
        }

        if (aiRes.status === 429) {
          return json({ error: "rate_limited", message: "Try again shortly." }, 429);
        }
        if (aiRes.status === 402) {
          // Gateway credit exhaustion â€” surface as 429 so the spoke does not
          // confuse it with a tier-gate 402.
          return json({ error: "credits_exhausted", message: "AI credits exhausted on the hub." }, 429);
        }
        if (!aiRes.ok) {
          const detail = await aiRes.text().catch(() => "");
          console.error("[creative-studio/poster] gateway error", aiRes.status, detail);
          return json({ error: "generation_failed" }, 502);
        }

        // Lovable AI Gateway returns OpenAI-compatible chat completions. For
        // image-capable models the image is on `message.images[0].image_url.url`
        // as a base64 data URL.
        type GatewayResp = {
          choices?: Array<{
            message?: {
              images?: Array<{ image_url?: { url?: string } }>;
            };
          }>;
        };
        const payload = (await aiRes.json().catch(() => null)) as GatewayResp | null;
        const dataUrl = payload?.choices?.[0]?.message?.images?.[0]?.image_url?.url ?? null;
        if (!dataUrl || !dataUrl.startsWith("data:")) {
          console.error("[creative-studio/poster] no image in gateway response");
          return json({ error: "generation_failed" }, 502);
        }

        const commaIdx = dataUrl.indexOf(",");
        const meta = dataUrl.slice(5, commaIdx); // e.g. "image/png;base64"
        const base64 = dataUrl.slice(commaIdx + 1);
        const mimeType = meta.split(";")[0] || "image/png";

        return json({
          ok: true,
          app: APP,
          tier: gate.tier,
          aspectRatio: parsed.aspectRatio,
          image: { mimeType, base64 },
        });
      },
    },
  },
});
