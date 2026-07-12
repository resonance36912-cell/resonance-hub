
import { AppLink } from "@/components/AppLink";import {
  Body,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from '@react-email/components'
import type { TemplateEntry } from './registry'

const SITE_NAME = 'Resonance Hub'
const BRAND = '#c026d3'
const DANGER = '#dc2626'

export interface CiFailureAlertProps {
  failures?: Array<{
    repo: string
    workflow_name: string
    head_branch: string
    conclusion: string
    actor?: string | null
    commit_message?: string | null
    html_url: string
    updated_at: string
  }>
  dashboardUrl?: string
  summary?: string
}

const CiFailureAlertEmail = ({
  failures = [],
  dashboardUrl = 'https://reson8.life/admin/ci-health',
  summary,
}: CiFailureAlertProps) => {
  const count = failures.length
  const repos = Array.from(new Set(failures.map((f) => f.repo)))
  const heading =
    count === 0
      ? 'CI failure alert'
      : count === 1
        ? `1 workflow run failed`
        : `${count} workflow runs failed`

  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>
        {summary ?? `${count} CI failure${count === 1 ? '' : 's'} across ${repos.length} repo${repos.length === 1 ? '' : 's'}`}
      </Preview>
      <Body style={main}>
        <Container style={container}>
          <Section style={header}>
            <Heading style={brandHeading}>{SITE_NAME}</Heading>
          </Section>

          <Heading style={h1}>{heading}</Heading>
          <Text style={text}>
            {count === 0
              ? 'A CI failure alert was triggered but no failures were included.'
              : `New failing workflow run${count === 1 ? '' : 's'} detected across ${repos.length} repo${repos.length === 1 ? '' : 's'}. Details below.`}
          </Text>

          {failures.map((f) => (
            <Section key={`${f.repo}-${f.html_url}`} style={card}>
              <Text style={cardRepo}>{f.repo}</Text>
              <Text style={cardWorkflow}>
                <AppLink href={f.html_url} style={cardLink}>
                  {f.workflow_name}
                </AppLink>{' '}
                <span style={cardBadge}>{f.conclusion}</span>
              </Text>
              <Text style={cardMeta}>
                branch <code style={mono}>{f.head_branch}</code>
                {f.actor ? ` · by ${f.actor}` : ''}
                {` · ${new Date(f.updated_at).toUTCString()}`}
              </Text>
              {f.commit_message ? (
                <Text style={cardCommit}>{f.commit_message}</Text>
              ) : null}
            </Section>
          ))}

          <Section style={{ marginTop: 24 }}>
            <AppLink href={dashboardUrl} style={cta}>
              Open CI Health dashboard
            </AppLink>
          </Section>

          <Hr style={hr} />
          <Text style={footer}>
            You're receiving this because you enabled CI failure alerts for the
            Resonance Hub monitored repositories. Manage the watchlist and
            recipient in <AppLink href={dashboardUrl} style={cardLink}>/admin/ci-health</AppLink>.
          </Text>
        </Container>
      </Body>
    </Html>
  )
}

export const template = {
  component: CiFailureAlertEmail,
  subject: (data: Record<string, any>) => {
    const failures = Array.isArray(data?.failures) ? data.failures : []
    const n = failures.length
    if (n === 0) return `[${SITE_NAME}] CI failure alert`
    if (n === 1) {
      const f = failures[0] as { repo?: string; workflow_name?: string }
      return `[CI ✗] ${f.repo ?? 'repo'} — ${f.workflow_name ?? 'workflow'} failed`
    }
    return `[CI ✗] ${n} workflow runs failed across your repos`
  },
  displayName: 'CI failure alert',
  previewData: {
    failures: [
      {
        repo: 'resonance36912-cell/Hub',
        workflow_name: 'verify-prebuild',
        head_branch: 'main',
        conclusion: 'failure',
        actor: 'octocat',
        commit_message: 'refactor: tighten checkout link verifier',
        html_url: 'https://github.com/example/example/actions/runs/123',
        updated_at: new Date().toISOString(),
      },
    ],
    dashboardUrl: 'https://reson8.life/admin/ci-health',
  },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: 'Arial, sans-serif' }
const container = { padding: '24px 28px', maxWidth: 640, margin: '0 auto' }
const header = { paddingBottom: 12, borderBottom: `2px solid ${BRAND}` }
const brandHeading = { color: BRAND, fontSize: 20, margin: 0 }
const h1 = { fontSize: 22, margin: '20px 0 8px', color: '#111' }
const text = { fontSize: 14, lineHeight: '22px', color: '#333' }
const card = {
  border: '1px solid #e5e7eb',
  borderLeft: `4px solid ${DANGER}`,
  borderRadius: 6,
  padding: '12px 14px',
  margin: '12px 0',
  backgroundColor: '#fafafa',
}
const cardRepo = { margin: 0, fontSize: 12, color: '#6b7280', fontFamily: 'monospace' }
const cardWorkflow = { margin: '4px 0 6px', fontSize: 15, color: '#111', fontWeight: 600 }
const cardLink = { color: BRAND, textDecoration: 'underline' }
const cardBadge = {
  fontSize: 11,
  padding: '2px 6px',
  border: `1px solid ${DANGER}`,
  color: DANGER,
  borderRadius: 4,
  marginLeft: 6,
}
const cardMeta = { margin: 0, fontSize: 12, color: '#6b7280' }
const cardCommit = { margin: '6px 0 0', fontSize: 13, color: '#374151', fontStyle: 'italic' }
const mono = { fontFamily: 'monospace' }
const cta = {
  display: 'inline-block',
  padding: '10px 16px',
  backgroundColor: BRAND,
  color: '#ffffff',
  borderRadius: 6,
  textDecoration: 'none',
  fontWeight: 600,
  fontSize: 14,
}
const hr = { borderColor: '#e5e7eb', margin: '24px 0' }
const footer = { fontSize: 11, color: '#6b7280', lineHeight: '18px' }
