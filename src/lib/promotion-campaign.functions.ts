import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getRonsRuntimePath } from "@/lib/rons-runtime-paths.server";

async function assertAdmin(userId: string) {
  const { data } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  if (!data) throw new Error("Forbidden: admin role required");
}

const CONTACTS = getRonsRuntimePath("promotion", "contacts.json");
const CAMPAIGNS = getRonsRuntimePath("promotion", "campaigns.json");
const HANDOFFS = getRonsRuntimePath("promotion", "handoffs.json");
const AUDIT = getRonsRuntimePath("promotion", "audit.jsonl");

type Contact = {
  id: string;
  email: string;
  name: string;
  organisation: string;
  segment: string;
  status: string;
  opted_in: boolean;
  consent_basis: string;
};
type Snapshot = { contact_id: string; email: string; name: string; organisation: string };
type Approval = {
  approved_at: string;
  approved_by_hash: string;
  approval_note: string;
  audience_count: number;
  estimated_cost_usd: number | null;
  cost_per_1000_usd: number | null;
  content_sha256: string;
};
type Campaign = {
  id: string;
  name: string;
  segment: string;
  template_key: string;
  subject: string;
  text_body: string;
  html_body: string;
  status: "draft" | "approved" | "handed_off";
  created_at: string;
  updated_at: string;
  approval: Approval | null;
  audience_snapshot: Snapshot[];
  handoff_id: string | null;
};
type Handoff = {
  id: string;
  campaign_id: string;
  created_at: string;
  content_sha256: string;
  segment: string;
  audience_snapshot: Snapshot[];
  subject: string;
  text_body: string;
  html_body: string;
  approval: Approval;
  send_authority: false;
};
async function readJson<T>(path: string, fallback: T): Promise<T> {
  const { readFile } = await import("node:fs/promises");
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch {
    return fallback;
  }
}
async function writeJson(path: string, value: unknown) {
  const { mkdir, writeFile, rename } = await import("node:fs/promises");
  const { dirname } = await import("node:path");
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path + ".tmp", JSON.stringify(value, null, 2), "utf8");
  await rename(path + ".tmp", path);
}
async function audit(event: string, payload: Record<string, unknown>) {
  const { mkdir, appendFile } = await import("node:fs/promises");
  const { dirname } = await import("node:path");
  await mkdir(dirname(AUDIT), { recursive: true });
  await appendFile(
    AUDIT,
    JSON.stringify({ ts: new Date().toISOString(), event, ...payload }) + "\n",
    "utf8",
  );
}
const eligible = (c: Contact) => c.status === "active" && c.opted_in && !!c.consent_basis?.trim();
const clean = (v: string) => v.trim();
async function sha256(v: string) {
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(v).digest("hex");
}
function costFor(count: number) {
  const raw = process.env.RONS_EMAIL_COST_PER_1000_USD;
  const rate = raw ? Number(raw) : null;
  return {
    rate: rate != null && Number.isFinite(rate) ? rate : null,
    estimate:
      rate != null && Number.isFinite(rate) ? Number(((count / 1000) * rate).toFixed(6)) : null,
  };
}
const DraftInput = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1).max(160),
  segment: z.string().min(1).max(120),
  template_key: z.string().max(120).default("custom"),
  subject: z.string().min(1).max(300),
  text_body: z.string().min(1).max(100000),
  html_body: z.string().max(200000).default(""),
});
export const listPromotionCampaigns = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.userId);
    return {
      campaigns: await readJson<Campaign[]>(CAMPAIGNS, []),
      handoffs: await readJson<Handoff[]>(HANDOFFS, []),
      send_authority: false,
    };
  });
export const savePromotionCampaignDraft = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((v: unknown) => DraftInput.parse(v))
  .handler(async ({ context, data }) => {
    await assertAdmin(context.userId);
    const rows = await readJson<Campaign[]>(CAMPAIGNS, []);
    const now = new Date().toISOString();
    const { randomUUID } = await import("node:crypto");
    if (data.id) {
      const row = rows.find((r) => r.id === data.id);
      if (!row) throw new Error("Campaign not found");
      if (row.status !== "draft") throw new Error("Approved campaigns are immutable");
      Object.assign(row, { ...data, updated_at: now });
      await writeJson(CAMPAIGNS, rows);
      await audit("campaign.updated", { id: row.id });
      return { campaign: row };
    }
    const row: Campaign = {
      ...data,
      id: randomUUID(),
      status: "draft",
      created_at: now,
      updated_at: now,
      approval: null,
      audience_snapshot: [],
      handoff_id: null,
    };
    rows.unshift(row);
    await writeJson(CAMPAIGNS, rows);
    await audit("campaign.created", { id: row.id, segment: row.segment });
    return { campaign: row };
  });
const ApproveInput = z.object({
  id: z.string().uuid(),
  approval_note: z.string().min(3).max(1000),
});
export const approvePromotionCampaign = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((v: unknown) => ApproveInput.parse(v))
  .handler(async ({ context, data }) => {
    await assertAdmin(context.userId);
    const rows = await readJson<Campaign[]>(CAMPAIGNS, []);
    const row = rows.find((r) => r.id === data.id);
    if (!row) throw new Error("Campaign not found");
    if (row.status !== "draft") throw new Error("Campaign is not a draft");
    const contacts = await readJson<Contact[]>(CONTACTS, []);
    const audience = contacts
      .filter((c) => eligible(c) && (row.segment === "all" || c.segment === row.segment))
      .map((c) => ({
        contact_id: c.id,
        email: c.email,
        name: c.name || "",
        organisation: c.organisation || "",
      }));
    const content = JSON.stringify({
      subject: clean(row.subject),
      text_body: row.text_body,
      html_body: row.html_body,
      segment: row.segment,
      audience,
    });
    const content_sha256 = await sha256(content);
    const costs = costFor(audience.length);
    const approved_by_hash = await sha256(context.userId);
    row.status = "approved";
    row.updated_at = new Date().toISOString();
    row.audience_snapshot = audience;
    row.approval = {
      approved_at: row.updated_at,
      approved_by_hash,
      approval_note: data.approval_note,
      audience_count: audience.length,
      estimated_cost_usd: costs.estimate,
      cost_per_1000_usd: costs.rate,
      content_sha256,
    };
    await writeJson(CAMPAIGNS, rows);
    await audit("campaign.approved", {
      id: row.id,
      audience_count: audience.length,
      content_sha256,
    });
    return { campaign: row, send_authority: false };
  });
const HandoffInput = z.object({ id: z.string().uuid() });
export const createPromotionCampaignHandoff = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((v: unknown) => HandoffInput.parse(v))
  .handler(async ({ context, data }) => {
    await assertAdmin(context.userId);
    const rows = await readJson<Campaign[]>(CAMPAIGNS, []);
    const row = rows.find((r) => r.id === data.id);
    if (!row || row.status !== "approved" || !row.approval)
      throw new Error("Campaign must be approved first");
    const handoffs = await readJson<Handoff[]>(HANDOFFS, []);
    const { randomUUID } = await import("node:crypto");
    const handoff: Handoff = {
      id: randomUUID(),
      campaign_id: row.id,
      created_at: new Date().toISOString(),
      content_sha256: row.approval.content_sha256,
      segment: row.segment,
      audience_snapshot: row.audience_snapshot,
      subject: row.subject,
      text_body: row.text_body,
      html_body: row.html_body,
      approval: row.approval,
      send_authority: false,
    };
    handoffs.unshift(handoff);
    row.status = "handed_off";
    row.handoff_id = handoff.id;
    row.updated_at = handoff.created_at;
    await writeJson(HANDOFFS, handoffs);
    await writeJson(CAMPAIGNS, rows);
    await audit("campaign.handoff_created", {
      id: row.id,
      handoff_id: handoff.id,
      audience_count: handoff.audience_snapshot.length,
    });
    return { handoff, send_authority: false };
  });
