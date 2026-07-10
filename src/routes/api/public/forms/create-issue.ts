// Public endpoint that accepts a form submission and files a GitHub issue.
// Security posture:
//   - `/api/public/*` bypasses site auth, so this handler is the only gate.
//   - Repo target must be in FORM_ISSUE_ALLOWED_REPOS (comma-separated env).
//   - Zod enforces strict length/format limits on every field.
//   - Honeypot field silently drops bot submissions.
//   - Body is composed from validated fields only; no raw HTML is echoed.
//   - GitHub token is never exposed to the browser (connector gateway).

import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const GATEWAY_URL = "https://connector-gateway.lovable.dev/github";

const bodySchema = z.object({
  repo: z
    .string()
    .trim()
    .regex(/^[\w.-]+\/[\w.-]+$/, "repo must be owner/name"),
  title: z.string().trim().min(3).max(200),
  message: z.string().trim().min(10).max(4000),
  name: z.string().trim().max(100).optional().default(""),
  email: z.string().trim().email().max(255).optional().or(z.literal("")).default(""),
  source: z.string().trim().max(200).optional().default(""),
  labels: z.array(z.string().trim().min(1).max(50)).max(10).optional().default([]),
  // Honeypot — real users leave this empty; bots fill every input.
  website: z.string().max(0).optional().default(""),
});

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...CORS_HEADERS },
  });
}

// Prevent injecting extra Markdown/HTML sections into the composed body.
// GitHub renders Markdown but not raw HTML script tags; we still strip HTML
// tags defensively and cap length.
function sanitize(v: string, max = 4000): string {
  return v.replace(/<\/?[^>]+>/g, "").slice(0, max);
}

function composeBody(input: z.infer<typeof bodySchema>, request: Request): string {
  const ua = request.headers.get("user-agent") ?? "";
  const ref = request.headers.get("referer") ?? "";
  const lines = [
    "**Submitted via website form**",
    "",
    sanitize(input.message),
    "",
    "---",
    "",
    `- **From:** ${sanitize(input.name || "(anonymous)", 100)}`,
    input.email ? `- **Email:** ${sanitize(input.email, 255)}` : null,
    input.source ? `- **Source:** ${sanitize(input.source, 200)}` : null,
    ref ? `- **Referer:** ${sanitize(ref, 300)}` : null,
    ua ? `- **User-Agent:** ${sanitize(ua, 300)}` : null,
    `- **Submitted:** ${new Date().toISOString()}`,
  ].filter(Boolean);
  return lines.join("\n");
}

export const Route = createFileRoute("/api/public/forms/create-issue")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS_HEADERS }),
      POST: async ({ request }) => {
        const lovableKey = process.env.LOVABLE_API_KEY;
        const ghKey = process.env.GITHUB_API_KEY;
        if (!lovableKey || !ghKey) {
          return json(503, {
            error: "GitHub connector not configured on the server.",
          });
        }

        const allowlist = (process.env.FORM_ISSUE_ALLOWED_REPOS ?? "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        if (allowlist.length === 0) {
          return json(503, {
            error:
              "FORM_ISSUE_ALLOWED_REPOS is not set; refusing to create issues.",
          });
        }

        let raw: unknown;
        try {
          raw = await request.json();
        } catch {
          return json(400, { error: "Invalid JSON body." });
        }

        const parsed = bodySchema.safeParse(raw);
        if (!parsed.success) {
          return json(400, {
            error: "Invalid input.",
            issues: parsed.error.issues.map((i) => ({
              path: i.path.join("."),
              message: i.message,
            })),
          });
        }
        const input = parsed.data;

        // Honeypot tripped — silently ack so bots don't retry.
        if (input.website) return json(202, { ok: true });

        if (!allowlist.includes(input.repo)) {
          return json(403, {
            error: `Repo not allowed. Configure FORM_ISSUE_ALLOWED_REPOS to include "${input.repo}".`,
          });
        }

        const payload = {
          title: sanitize(input.title, 200),
          body: composeBody(input, request),
          labels: input.labels,
        };

        const gh = await fetch(`${GATEWAY_URL}/repos/${input.repo}/issues`, {
          method: "POST",
          headers: {
            Accept: "application/vnd.github+json",
            "Content-Type": "application/json",
            Authorization: `Bearer ${lovableKey}`,
            "X-Connection-Api-Key": ghKey,
          },
          body: JSON.stringify(payload),
        });

        if (!gh.ok) {
          const text = await gh.text();
          console.error(
            `[forms/create-issue] GitHub ${gh.status} for ${input.repo}: ${text.slice(0, 500)}`,
          );
          return json(502, {
            error: "Failed to create issue on GitHub.",
            status: gh.status,
          });
        }

        const issue = (await gh.json()) as {
          number: number;
          html_url: string;
          id: number;
        };
        return json(201, {
          ok: true,
          number: issue.number,
          html_url: issue.html_url,
          id: issue.id,
        });
      },
    },
  },
});
