import { createServerFn } from '@tanstack/react-start'
import { requireRonsAuth } from '@/lib/rons-auth-middleware'
import { hasServerBackendRole } from '@/lib/backend-provider.server'

const SENDER_DOMAIN = 'notify.www.reson8.life'
const DKIM_SELECTORS = ['k1', 'mailo', 'lovable', 's1', 'smtp', 'email', 'default']

type DoHAnswer = { name: string; type: number; TTL: number; data: string }
type DoHResponse = { Status: number; Answer?: DoHAnswer[] }

async function dohQuery(name: string, type: 'TXT' | 'MX' | 'NS'): Promise<DoHAnswer[]> {
  const url = `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=${type}`
  const res = await fetch(url, { headers: { Accept: 'application/dns-json' } })
  if (!res.ok) return []
  const json = (await res.json()) as DoHResponse
  return json.Answer ?? []
}

function unquote(s: string) {
  // DoH returns TXT with surrounding quotes and possibly concatenated chunks like "abc" "def"
  return s
    .split(/"\s+"/)
    .map((p) => p.replace(/^"|"$/g, ''))
    .join('')
}

export type RecordCheck = {
  label: string
  type: 'TXT' | 'MX' | 'NS' | 'CNAME'
  host: string
  ok: boolean
  found: string[]
  expectedHint: string
  detail: string
}

export const checkEmailDomain = createServerFn({ method: 'POST' })
  .middleware([requireRonsAuth])
  .handler(async ({ context }) => {
    if (!(await hasServerBackendRole(context.userId, 'admin'))) {
      return { ok: false as const, error: 'Forbidden — admin role required.' }
    }

    // NS delegation
    const nsAnswers = await dohQuery(SENDER_DOMAIN, 'NS')
    const nsValues = nsAnswers.map((a) => a.data.replace(/\.$/, '').toLowerCase())
    const nsOk = nsValues.some((v) => v.endsWith('lovable.cloud'))

    // SPF
    const txtAnswers = await dohQuery(SENDER_DOMAIN, 'TXT')
    const txtValues = txtAnswers.map((a) => unquote(a.data))
    const spfRecord = txtValues.find((v) => v.toLowerCase().startsWith('v=spf1'))

    // DMARC
    const dmarcAnswers = await dohQuery(`_dmarc.${SENDER_DOMAIN}`, 'TXT')
    const dmarcValues = dmarcAnswers.map((a) => unquote(a.data))
    const dmarcRecord = dmarcValues.find((v) => v.toLowerCase().startsWith('v=dmarc1'))

    // DKIM — probe common selectors
    let dkimRecord: string | null = null
    let dkimSelector: string | null = null
    for (const sel of DKIM_SELECTORS) {
      const ans = await dohQuery(`${sel}._domainkey.${SENDER_DOMAIN}`, 'TXT')
      const vals = ans.map((a) => unquote(a.data))
      const match = vals.find((v) => v.toLowerCase().includes('v=dkim1') || v.toLowerCase().includes('k=rsa'))
      if (match) {
        dkimRecord = match
        dkimSelector = sel
        break
      }
    }

    // MX
    const mxAnswers = await dohQuery(SENDER_DOMAIN, 'MX')
    const mxValues = mxAnswers.map((a) => a.data.toLowerCase())
    const mxOk = mxValues.length > 0

    const checks: RecordCheck[] = [
      {
        label: 'Nameserver delegation',
        type: 'NS',
        host: SENDER_DOMAIN,
        ok: nsOk,
        found: nsValues,
        expectedHint: 'ns5.lovable.cloud / ns6.lovable.cloud',
        detail: nsOk
          ? 'Subdomain is delegated to Lovable for managed email DNS.'
          : 'NS records are missing — add them at your domain registrar so Lovable can manage SPF/DKIM/DMARC.',
      },
      {
        label: 'SPF',
        type: 'TXT',
        host: SENDER_DOMAIN,
        ok: !!spfRecord,
        found: spfRecord ? [spfRecord] : [],
        expectedHint: 'v=spf1 include:mailgun.org ~all',
        detail: spfRecord
          ? 'Sender Policy Framework configured — authorizes Lovable to send on your behalf.'
          : 'SPF record not yet visible. DNS may still be propagating (up to 72h).',
      },
      {
        label: 'DKIM',
        type: 'TXT',
        host: dkimSelector ? `${dkimSelector}._domainkey.${SENDER_DOMAIN}` : `<selector>._domainkey.${SENDER_DOMAIN}`,
        ok: !!dkimRecord,
        found: dkimRecord ? [dkimRecord.slice(0, 80) + (dkimRecord.length > 80 ? '…' : '')] : [],
        expectedHint: 'v=DKIM1; k=rsa; p=<public-key>',
        detail: dkimRecord
          ? `DKIM signing key published (selector: ${dkimSelector}).`
          : 'No DKIM selector found from common names. Lovable manages this automatically once NS delegation is live.',
      },
      {
        label: 'DMARC',
        type: 'TXT',
        host: `_dmarc.${SENDER_DOMAIN}`,
        ok: !!dmarcRecord,
        found: dmarcRecord ? [dmarcRecord] : [],
        expectedHint: 'v=DMARC1; p=none; rua=mailto:...',
        detail: dmarcRecord
          ? 'DMARC policy published — protects against spoofing.'
          : 'DMARC record not yet visible. Lovable provisions this on the delegated subdomain.',
      },
      {
        label: 'MX',
        type: 'MX',
        host: SENDER_DOMAIN,
        ok: mxOk,
        found: mxValues,
        expectedHint: 'mxa.mailgun.org / mxb.mailgun.org',
        detail: mxOk ? 'Mail exchanger configured.' : 'No MX records — bounce handling may be limited.',
      },
    ]

    const verifiedCount = checks.filter((c) => c.ok).length
    const allVerified = checks.every((c) => c.ok)

    return {
      ok: true as const,
      domain: SENDER_DOMAIN,
      allVerified,
      verifiedCount,
      totalCount: checks.length,
      checks,
      checkedAt: new Date().toISOString(),
    }
  })
