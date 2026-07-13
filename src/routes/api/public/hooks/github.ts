import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "crypto";

/**
 * GitHub webhook receiver.
 *
 * Configure on each spoke/hub repo:
 *   Payload URL:  https://reson8.life/api/public/hooks/github
 *   Content type: application/json
 *   Secret:       (matches GITHUB_WEBHOOK_SECRET)
 *   Events:       pull_request, push, workflow_run, ping
 *
 * On PR open/sync/reopen and pushes to non-default branches, we dispatch the
 * canonical verification workflows on the target repo via the connector
 * gateway so builds are triggered automatically.
 */

const GATEWAY_URL = "https://connector-gateway.lovable.dev/github";

// Workflows we auto-trigger on PR/push events, if present on the repo.
const AUTO_DISPATCH_WORKFLOWS = [
  "verify-prebuild.yml",
  "verify-checkout-links.yml",
  "security-scan.yml",
];

function safeSigEq(a: string, b: string): boolean {
  try {
    const aBuf = Buffer.from(a);
    const bBuf = Buffer.from(b);
    if (aBuf.length !== bBuf.length) return false;
    return timingSafeEqual(aBuf, bBuf);
  } catch {
    return false;
  }
}

function verifySignature(rawBody: string, headerSig: string | null, secret: string): boolean {
  if (!headerSig || !headerSig.startsWith("sha256=")) return false;
  const expected =
    "sha256=" + createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  return safeSigEq(headerSig, expected);
}

async function dispatchWorkflow(
  repo: string,
  workflow: string,
  ref: string,
  lovableKey: string,
  ghKey: string,
): Promise<{ workflow: string; ok: boolean; status: number; error?: string }> {
  const res = await fetch(
    `${GATEWAY_URL}/repos/${repo}/actions/workflows/${workflow}/dispatches`,
    {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${lovableKey}`,
        "X-Connection-Api-Key": ghKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ref }),
    },
  );
  if (res.status === 204) return { workflow, ok: true, status: 204 };
  const body = await res.text();
  return { workflow, ok: false, status: res.status, error: body.slice(0, 200) };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const Route = createFileRoute("/api/public/hooks/github")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env.GITHUB_WEBHOOK_SECRET;
        const rawBody = await request.text();
        const deliveryId =
          request.headers.get("x-github-delivery")?.trim() || "";
        const event = request.headers.get("x-github-event")?.trim() || "";
        const sig = request.headers.get("x-hub-signature-256");

        if (!secret) {
          return jsonResponse(500, { error: "webhook_secret_not_configured" });
        }
        if (!deliveryId || !event) {
          return jsonResponse(400, { error: "missing_github_headers" });
        }

        const signatureValid = verifySignature(rawBody, sig, secret);
        if (!signatureValid) {
          await logEvent({
            delivery_id: deliveryId,
            event,
            signature_valid: false,
            http_status: 401,
            raw_payload: safeParse(rawBody),
          });
          return jsonResponse(401, { error: "invalid_signature" });
        }

        // Ping = handshake test from GitHub
        if (event === "ping") {
          await logEvent({
            delivery_id: deliveryId,
            event,
            signature_valid: true,
            http_status: 200,
            raw_payload: safeParse(rawBody),
          });
          return jsonResponse(200, { ok: true, pong: true });
        }

        const payload = safeParse(rawBody);
        const repo: string | null = payload?.repository?.full_name ?? null;
        const sender: string | null = payload?.sender?.login ?? null;
        const action: string | null = payload?.action ?? null;
        const prNumber: number | null = payload?.pull_request?.number ?? null;
        const headSha: string | null =
          payload?.pull_request?.head?.sha ?? payload?.after ?? null;
        const ref: string | null =
          payload?.pull_request?.head?.ref ?? payload?.ref ?? null;

        // Decide whether to dispatch verification workflows.
        const shouldDispatch =
          !!repo &&
          !!ref &&
          ((event === "pull_request" &&
            ["opened", "synchronize", "reopened", "ready_for_review"].includes(
              action ?? "",
            )) ||
            (event === "push" && !payload?.deleted));

        let dispatched: string[] = [];
        let dispatchError: string | null = null;

        if (shouldDispatch) {
          const lovableKey = process.env.LOVABLE_API_KEY;
          const ghKey = process.env.GITHUB_API_KEY;
          if (!lovableKey || !ghKey) {
            dispatchError = "github_gateway_not_configured";
          } else {
            // Refs from pull_request are branch names; from push are refs/heads/x.
            const dispatchRef = ref.replace(/^refs\/heads\//, "");
            const results = await Promise.all(
              AUTO_DISPATCH_WORKFLOWS.map((w) =>
                dispatchWorkflow(repo!, w, dispatchRef, lovableKey, ghKey).catch(
                  (err) => ({
                    workflow: w,
                    ok: false,
                    status: 0,
                    error: String(err).slice(0, 200),
                  }),
                ),
              ),
            );
            dispatched = results.filter((r) => r.ok).map((r) => r.workflow);
            const failed = results.filter((r) => !r.ok);
            if (failed.length) {
              dispatchError = failed
                .map((f) => `${f.workflow}:${f.status}:${f.error ?? ""}`)
                .join(" | ")
                .slice(0, 500);
            }
          }
        }

        const httpStatus = 200;
        await logEvent({
          delivery_id: deliveryId,
          event,
          action,
          repo,
          sender,
          ref,
          pr_number: prNumber,
          head_sha: headSha,
          signature_valid: true,
          dispatched_workflows: dispatched,
          dispatch_error: dispatchError,
          http_status: httpStatus,
          raw_payload: payload,
        });

        return jsonResponse(httpStatus, {
          ok: true,
          event,
          action,
          repo,
          dispatched,
          dispatch_error: dispatchError,
        });
      },
    },
  },
});

function safeParse(body: string): any {
  try {
    return JSON.parse(body);
  } catch {
    return { _unparsed: body.slice(0, 1000) };
  }
}

type EventRow = {
  delivery_id: string;
  event: string;
  action?: string | null;
  repo?: string | null;
  sender?: string | null;
  ref?: string | null;
  pr_number?: number | null;
  head_sha?: string | null;
  signature_valid: boolean;
  dispatched_workflows?: string[];
  dispatch_error?: string | null;
  http_status: number;
  raw_payload: any;
};

async function logEvent(row: EventRow) {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // Idempotent: delivery_id is UNIQUE; ignore duplicate re-deliveries.
    await supabaseAdmin
      .from("github_webhook_events")
      .upsert(row, { onConflict: "delivery_id", ignoreDuplicates: true });
  } catch (err) {
    console.error("github webhook log failed:", err);
  }
}
