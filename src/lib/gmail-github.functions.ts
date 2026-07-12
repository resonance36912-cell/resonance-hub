import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const GATEWAY_URL = "https://connector-gateway.lovable.dev/google_mail/gmail/v1";

async function requireAdmin(ctx: { supabase: any; userId: string }) {
  const { data, error } = await ctx.supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", ctx.userId)
    .eq("role", "admin")
    .maybeSingle();
  if (error || !data) throw new Error("Forbidden");
}

function authHeaders() {
  const lovableKey = process.env.LOVABLE_API_KEY;
  const gmailKey = process.env.GOOGLE_MAIL_API_KEY;
  if (!lovableKey) throw new Error("LOVABLE_API_KEY missing");
  if (!gmailKey) throw new Error("GOOGLE_MAIL_API_KEY missing (Gmail connector not linked)");
  return {
    Authorization: `Bearer ${lovableKey}`,
    "X-Connection-Api-Key": gmailKey,
  };
}

async function gmailFetch(path: string): Promise<any> {
  const res = await fetch(`${GATEWAY_URL}${path}`, { headers: authHeaders() });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Gmail gateway ${res.status}: ${body.slice(0, 300)}`);
  }
  return res.json();
}

function b64UrlDecode(input: string): string {
  const s = input.replace(/-/g, "+").replace(/_/g, "/");
  const pad = s.length % 4 === 0 ? s : s + "=".repeat(4 - (s.length % 4));
  try {
    // atob is available in the Worker runtime
    const bin = atob(pad);
    // Convert binary string to UTF-8
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder("utf-8").decode(bytes);
  } catch {
    return "";
  }
}

type GmailPayloadPart = {
  mimeType?: string;
  body?: { data?: string; size?: number };
  parts?: GmailPayloadPart[];
  headers?: Array<{ name: string; value: string }>;
};

function extractBody(payload: GmailPayloadPart | undefined): { text: string; html: string } {
  let text = "";
  let html = "";
  function walk(p?: GmailPayloadPart) {
    if (!p) return;
    const mt = (p.mimeType ?? "").toLowerCase();
    const data = p.body?.data;
    if (data) {
      const decoded = b64UrlDecode(data);
      if (mt === "text/plain" && !text) text = decoded;
      else if (mt === "text/html" && !html) html = decoded;
    }
    p.parts?.forEach(walk);
  }
  walk(payload);
  return { text, html };
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

export type GitHubEmail = {
  id: string;
  threadId: string;
  from: string;
  subject: string;
  date: string;
  snippet: string;
  bodyText: string;
  links: string[];
  repo: string | null;
  kind: "workflow_failure" | "security_alert" | "dependabot" | "pr_review" | "issue" | "other";
  actionLinks: {
    runUrl?: string;
    repoUrl?: string;
    logsUrl?: string;
  };
};

function classify(subject: string, from: string, body: string): GitHubEmail["kind"] {
  const s = subject.toLowerCase();
  const f = from.toLowerCase();
  if (s.includes("run failed") || s.includes("workflow run failed") || s.includes("failed in")) return "workflow_failure";
  if (f.includes("noreply@github.com") && (s.includes("security") || s.includes("vulnerabilit") || s.includes("advisory"))) return "security_alert";
  if (f.includes("dependabot") || s.includes("dependabot")) return "dependabot";
  if (s.includes("pull request") || s.includes("review requested")) return "pr_review";
  if (s.includes("issue") || s.includes("opened") || s.includes("closed")) return "issue";
  if (body.toLowerCase().includes("actions/runs/")) return "workflow_failure";
  return "other";
}

function extractRepo(links: string[]): string | null {
  for (const l of links) {
    const m = l.match(/github\.com\/([^\/\s"']+\/[^\/\s"'?#]+)/i);
    if (m) return m[1];
  }
  return null;
}

function extractLinks(text: string): string[] {
  const urls = new Set<string>();
  const re = /https?:\/\/[^\s<>"')]+/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) urls.add(m[0].replace(/[.,);]+$/, ""));
  return Array.from(urls);
}

function findRunUrl(links: string[]): string | undefined {
  return links.find((l) => /github\.com\/[^\/]+\/[^\/]+\/actions\/runs\/\d+/.test(l));
}

const ListInput = z.object({
  query: z.string().optional(),
  maxResults: z.number().int().min(1).max(50).optional(),
});

const DEFAULT_QUERY =
  'from:(notifications@github.com OR noreply@github.com) (subject:"run failed" OR subject:"failed" OR subject:"security" OR subject:"vulnerability" OR "actions/runs/") newer_than:14d';

export const listGitHubEmails = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => ListInput.parse(data ?? {}))
  .handler(async ({ data, context }) => {
    await requireAdmin(context);
    const q = data.query?.trim() || DEFAULT_QUERY;
    const max = data.maxResults ?? 25;

    const list = await gmailFetch(
      `/users/me/messages?maxResults=${max}&q=${encodeURIComponent(q)}`,
    );
    const ids: string[] = (list.messages ?? []).map((m: { id: string }) => m.id);

    const messages: GitHubEmail[] = [];
    // Serial fetch to keep it simple; small N
    for (const id of ids) {
      try {
        const msg = await gmailFetch(`/users/me/messages/${id}?format=full`);
        const headers: Array<{ name: string; value: string }> = msg.payload?.headers ?? [];
        const h = (name: string) =>
          headers.find((x) => x.name.toLowerCase() === name.toLowerCase())?.value ?? "";
        const from = h("From");
        const subject = h("Subject");
        const date = h("Date");
        const { text, html } = extractBody(msg.payload);
        const bodyText = (text || stripHtml(html)).slice(0, 8000);
        const links = extractLinks(text ? text : html);
        const repo = extractRepo(links);
        const runUrl = findRunUrl(links);
        messages.push({
          id: msg.id,
          threadId: msg.threadId,
          from,
          subject,
          date,
          snippet: msg.snippet ?? "",
          bodyText,
          links,
          repo,
          kind: classify(subject, from, bodyText),
          actionLinks: {
            runUrl,
            repoUrl: repo ? `https://github.com/${repo}` : undefined,
            logsUrl: runUrl ? `${runUrl}` : undefined,
          },
        });
      } catch (err) {
        // skip individual failures
        console.warn("Gmail message fetch failed", id, err);
      }
    }

    return {
      query: q,
      fetchedAt: new Date().toISOString(),
      count: messages.length,
      messages,
    };
  });

const MarkReadInput = z.object({ id: z.string().min(1) });

export const markGitHubEmailRead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => MarkReadInput.parse(data))
  .handler(async ({ data, context }) => {
    await requireAdmin(context);
    const res = await fetch(`${GATEWAY_URL}/users/me/messages/${data.id}/modify`, {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ removeLabelIds: ["UNREAD"] }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Gmail modify ${res.status}: ${body.slice(0, 300)}`);
    }
    return { ok: true };
  });
