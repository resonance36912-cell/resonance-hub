import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const DEFAULT_SENDER_DOMAIN = "reson8.life";

type DoHAnswer = { name: string; type: number; TTL: number; data: string };
type DoHResponse = { Status: number; Answer?: DoHAnswer[] };

async function dohQuery(name: string, type: "TXT" | "MX"): Promise<DoHAnswer[]> {
  const url = `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=${type}`;
  const res = await fetch(url, { headers: { Accept: "application/dns-json" } });
  if (!res.ok) return [];
  const json = (await res.json()) as DoHResponse;
  return json.Answer ?? [];
}

function unquote(value: string) {
  return value
    .split(/"\s+"/)
    .map((part) => part.replace(/^"|"$/g, ""))
    .join("");
}

function configuredSenderDomain(): string {
  const configured = process.env.RONS_EMAIL_SENDER_DOMAIN?.trim().toLowerCase();
  return configured || DEFAULT_SENDER_DOMAIN;
}

export type RecordCheck = {
  label: string;
  type: "TXT" | "MX";
  host: string;
  ok: boolean;
  required: boolean;
  found: string[];
  expectedHint: string;
  detail: string;
};

export const checkEmailDomain = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: roleRow } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .eq("role", "admin")
      .maybeSingle();
    if (!roleRow) return { ok: false as const, error: "Forbidden - admin role required." };

    const domain = configuredSenderDomain();
    const returnPathHost = `send.${domain}`;
    const dkimHost = `resend._domainkey.${domain}`;
    const dmarcHost = `_dmarc.${domain}`;

    const [spfAnswers, mxAnswers, dkimAnswers, dmarcAnswers] = await Promise.all([
      dohQuery(returnPathHost, "TXT"),
      dohQuery(returnPathHost, "MX"),
      dohQuery(dkimHost, "TXT"),
      dohQuery(dmarcHost, "TXT"),
    ]);

    const spfValues = spfAnswers.map((answer) => unquote(answer.data));
    const spfRecord = spfValues.find((value) => {
      const lower = value.toLowerCase();
      return lower.startsWith("v=spf1") && lower.includes("amazonses.com");
    });
    const mxValues = mxAnswers.map((answer) => answer.data.replace(/\.$/, "").toLowerCase());
    const mxRecord = mxValues.find((value) => value.includes("feedback-smtp.") && value.includes("amazonses.com"));
    const dkimValues = dkimAnswers.map((answer) => unquote(answer.data));
    const dkimRecord = dkimValues.find((value) => /(^|;)\s*p=/i.test(value) || /v=dkim1/i.test(value));
    const dmarcValues = dmarcAnswers.map((answer) => unquote(answer.data));
    const dmarcRecord = dmarcValues.find((value) => value.toLowerCase().startsWith("v=dmarc1"));

    const checks: RecordCheck[] = [
      {
        label: "SPF authorization",
        type: "TXT",
        host: returnPathHost,
        ok: Boolean(spfRecord),
        required: true,
        found: spfRecord ? [spfRecord] : [],
        expectedHint: "v=spf1 include:amazonses.com ~all (use the exact value supplied by Resend)",
        detail: spfRecord
          ? "SPF authorizes the Resend sending infrastructure."
          : "Required SPF record is not visible yet.",
      },
      {
        label: "Return-path MX",
        type: "MX",
        host: returnPathHost,
        ok: Boolean(mxRecord),
        required: true,
        found: mxValues,
        expectedHint: "feedback-smtp.<region>.amazonses.com, priority 10 (use the exact Resend value)",
        detail: mxRecord
          ? "Return-path MX is configured for bounce and complaint feedback."
          : "Required return-path MX record is not visible yet.",
      },
      {
        label: "DKIM signing",
        type: "TXT",
        host: dkimHost,
        ok: Boolean(dkimRecord),
        required: true,
        found: dkimRecord ? [dkimRecord.slice(0, 100) + (dkimRecord.length > 100 ? "..." : "")] : [],
        expectedHint: "Resend DKIM public key (use the exact value supplied for resend._domainkey)",
        detail: dkimRecord
          ? "DKIM public key is published."
          : "Required DKIM record is not visible yet.",
      },
      {
        label: "DMARC policy",
        type: "TXT",
        host: dmarcHost,
        ok: Boolean(dmarcRecord),
        required: false,
        found: dmarcRecord ? [dmarcRecord] : [],
        expectedHint: "v=DMARC1; p=none; ... (recommended before tightening policy)",
        detail: dmarcRecord
          ? "DMARC policy is published."
          : "DMARC is recommended for reputation and anti-spoofing, but does not block Resend verification.",
      },
    ];

    const requiredChecks = checks.filter((check) => check.required);
    const verifiedCount = requiredChecks.filter((check) => check.ok).length;
    const allVerified = requiredChecks.every((check) => check.ok);
    const transportConfigured = Boolean(process.env.RONS_RESEND_API_KEY?.trim() || process.env.RESEND_API_KEY?.trim());
    const webhookConfigured = Boolean(process.env.RONS_RESEND_WEBHOOK_SECRET?.trim());

    return {
      ok: true as const,
      domain,
      returnPathHost,
      dkimHost,
      allVerified,
      ready: allVerified && transportConfigured && webhookConfigured,
      verifiedCount,
      totalCount: requiredChecks.length,
      transportConfigured,
      webhookConfigured,
      webhookPath: "/api/public/email/suppression",
      checks,
      checkedAt: new Date().toISOString(),
    };
  });
