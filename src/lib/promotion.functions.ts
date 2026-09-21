import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireRonsAuth } from "@/lib/rons-auth-middleware";
import { hasBackendRole } from "@/lib/backend-provider.server";

async function assertAdmin(userId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  if (!(await hasBackendRole(userId, "admin", supabaseAdmin))) throw new Error("Forbidden");
}

const ROOT = String.raw`C:\Users\Ashley\Resonance\OpenNova\runtime\promotion`;
const STORE = `${ROOT}\\contacts.json`;
const AUDIT = `${ROOT}\\audit.jsonl`;
const ContactInput = z.object({
  name: z.string().max(160).default(""), organisation: z.string().max(200).default(""),
  website: z.string().max(500).default(""), email: z.string().email().max(320),
  contact_type: z.string().max(80).default("business"), source: z.string().max(500).default("manual"),
  consent_basis: z.string().max(500).default(""), opted_in: z.boolean().default(false),
  segment: z.string().max(120).default("general"), status: z.enum(["active","suppressed","unsubscribed"]).default("active"),
  notes: z.string().max(2000).default("")
});

type Contact = z.infer<typeof ContactInput> & { id: string; created_at: string; updated_at: string };
async function loadContacts(): Promise<Contact[]> {
  const { readFile } = await import("node:fs/promises");
  try { return JSON.parse(await readFile(STORE, "utf8")) as Contact[]; } catch { return []; }
}
async function saveContacts(rows: Contact[]) {
  const { mkdir, writeFile, rename } = await import("node:fs/promises");
  const { dirname } = await import("node:path");
  await mkdir(dirname(STORE), { recursive: true });
  await writeFile(STORE + ".tmp", JSON.stringify(rows, null, 2), "utf8");
  await rename(STORE + ".tmp", STORE);
}
async function audit(event: string, payload: Record<string, unknown>) {
  const { mkdir, appendFile } = await import("node:fs/promises");
  const { dirname } = await import("node:path");
  await mkdir(dirname(AUDIT), { recursive: true });
  await appendFile(AUDIT, JSON.stringify({ ts: new Date().toISOString(), event, ...payload }) + "\n", "utf8");
}
const normalizeEmail = (v: string) => v.trim().toLowerCase();
const eligible = (c: Contact) => c.status === "active" && c.opted_in && !!c.consent_basis.trim();

export const listPromotionContacts = createServerFn({ method: "GET" }).middleware([requireRonsAuth]).handler(async ({ context }) => {
  await assertAdmin(context.userId);
  const contacts = await loadContacts();
  return { contacts, storage: "local-json", send_authority: false, eligible_count: contacts.filter(eligible).length };
});
export const addPromotionContact = createServerFn({ method: "POST" }).middleware([requireRonsAuth]).validator((v: unknown) => ContactInput.parse(v)).handler(async ({ context, data }) => {
  await assertAdmin(context.userId);
  const rows = await loadContacts();
  const email = normalizeEmail(data.email);
  if (rows.some((r) => normalizeEmail(r.email) === email)) throw new Error("Contact email already exists");
  const now = new Date().toISOString();
  const { randomUUID } = await import("node:crypto");
  const row: Contact = { ...data, email, id: randomUUID(), created_at: now, updated_at: now };
  rows.unshift(row); await saveContacts(rows);
  await audit("contact.added", { id: row.id, status: row.status, opted_in: row.opted_in, segment: row.segment });
  return { contact: row };
});

const StatusInput = z.object({ id: z.string().uuid(), status: z.enum(["active","suppressed","unsubscribed"]), reason: z.string().max(500).default("") });
export const setPromotionContactStatus = createServerFn({ method: "POST" }).middleware([requireRonsAuth]).validator((v: unknown) => StatusInput.parse(v)).handler(async ({ context, data }) => {
  await assertAdmin(context.userId);
  const rows = await loadContacts();
  const row = rows.find((r) => r.id === data.id);
  if (!row) throw new Error("Contact not found");
  row.status = data.status; row.updated_at = new Date().toISOString();
  await saveContacts(rows); await audit("contact.status", { id: row.id, status: row.status, reason: data.reason });
  return { contact: row };
});
const CsvInput = z.object({ csv: z.string().min(1).max(2_000_000), default_segment: z.string().max(120).default("general") });
function parseCsvLine(line: string) {
  const out: string[] = []; let cur = ""; let q = false;
  for (let i=0;i<line.length;i++) { const ch=line[i]; if (ch==='"') { if(q && line[i+1]==='"'){cur+='"';i++;} else q=!q; } else if(ch===','&&!q){out.push(cur);cur="";} else cur+=ch; }
  out.push(cur); return out.map((x)=>x.trim());
}
export const importPromotionCsv = createServerFn({ method: "POST" }).middleware([requireRonsAuth]).validator((v: unknown) => CsvInput.parse(v)).handler(async ({ context, data }) => {
  await assertAdmin(context.userId);
  const lines = data.csv.replace(/\r/g,"").split("\n").filter(Boolean); if (!lines.length) throw new Error("CSV is empty");
  const headers=parseCsvLine(lines[0]).map((x)=>x.toLowerCase()); const rows=await loadContacts(); const seen=new Set(rows.map((r)=>normalizeEmail(r.email)));
  let added=0, skipped=0; const { randomUUID } = await import("node:crypto"); const now=new Date().toISOString();
  for (const line of lines.slice(1)) { const vals=parseCsvLine(line); const obj=Object.fromEntries(headers.map((h,i)=>[h,vals[i]??""])); const email=normalizeEmail(String(obj.email??""));
    if (!email || seen.has(email) || !/^\S+@\S+\.\S+$/.test(email)) { skipped++; continue; }
    const parsed=ContactInput.parse({ name:obj.name??"", organisation:obj.organisation??"", website:obj.website??"", email, contact_type:obj.contact_type??"business", source:obj.source??"csv-import", consent_basis:obj.consent_basis??"", opted_in:String(obj.opted_in??"").toLowerCase()==="true", segment:obj.segment??data.default_segment, status:obj.status??"active", notes:obj.notes??"" });
    rows.unshift({ ...parsed, id:randomUUID(), created_at:now, updated_at:now }); seen.add(email); added++;
  }
  await saveContacts(rows); await audit("contacts.csv_import", { added, skipped }); return { added, skipped, total: rows.length };
});
function csvCell(v: unknown) { const s=String(v??""); return /[",\n]/.test(s) ? `"${s.replace(/"/g,'""')}"` : s; }
export const exportPromotionCsv = createServerFn({ method: "GET" }).middleware([requireRonsAuth]).handler(async ({ context }) => {
  await assertAdmin(context.userId); const rows=await loadContacts();
  const cols=["name","organisation","website","email","contact_type","source","consent_basis","opted_in","segment","status","notes"] as const;
  const csv=[cols.join(","),...rows.map((r)=>cols.map((c)=>csvCell(r[c])).join(","))].join("\n");
  await audit("contacts.csv_export", { count: rows.length }); return { csv, filename:`rons-promotion-contacts-${new Date().toISOString().slice(0,10)}.csv` };
});

const PreflightInput = z.object({ segment: z.string().max(120).default("all") });
export const getPromotionPreflight = createServerFn({ method: "POST" }).middleware([requireRonsAuth]).validator((v: unknown) => PreflightInput.parse(v)).handler(async ({ context, data }) => {
  await assertAdmin(context.userId); const rows=await loadContacts(); const scope=data.segment==="all"?rows:rows.filter((r)=>r.segment===data.segment);
  const allowed=scope.filter(eligible); const suppressed=scope.filter((r)=>r.status==="suppressed").length; const unsubscribed=scope.filter((r)=>r.status==="unsubscribed").length;
  const noConsent=scope.filter((r)=>r.status==="active" && !eligible(r)).length; const rateRaw=process.env.RONS_EMAIL_COST_PER_1000_USD; const rate=rateRaw?Number(rateRaw):null;
  const estimated_cost_usd=rate!=null && Number.isFinite(rate)?Number(((allowed.length/1000)*rate).toFixed(6)):null;
  return { segment:data.segment, total:scope.length, eligible:allowed.length, excluded:scope.length-allowed.length, suppressed, unsubscribed, no_consent:noConsent, cost_per_1000_usd:rate, estimated_cost_usd, send_authority:false, requires_human_approval:true };
});
