import {
  Body,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Preview,
  Section,
  Text,
} from '@react-email/components'
import type { TemplateEntry } from './registry'

const SITE_NAME = 'The Resonance'
const BRAND = '#c026d3' // primary accent

interface SubscriptionConfirmedProps {
  customerName?: string
  sku?: string
  app?: string
  tier?: string
  amountZar?: string
  renewalDate?: string
}

const SubscriptionConfirmedEmail = ({
  customerName,
  sku = 'RES-SUB',
  app = 'Resonance',
  tier = 'Standard',
  amountZar = 'R 0.00',
  renewalDate = '—',
}: SubscriptionConfirmedProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Your {SITE_NAME} subscription is active</Preview>
    <Body style={main}>
      <Container style={container}>
        <Section style={header}>
          <Heading style={brandHeading}>{SITE_NAME}</Heading>
        </Section>

        <Heading style={h1}>Subscription confirmed</Heading>
        <Text style={text}>
          {customerName ? `Hi ${customerName},` : 'Hi there,'} thanks for
          subscribing — your access is now active.
        </Text>

        <Section style={card}>
          <Row label="App" value={app} />
          <Row label="Access tier" value={tier} />
          <Row label="SKU" value={sku} />
          <Row label="Amount" value={`${amountZar} ZAR`} />
          <Row label="Next renewal" value={renewalDate} />
        </Section>

        <Hr style={hr} />
        <Text style={footer}>
          You're receiving this because a payment was processed via PayFast for
          your {SITE_NAME} account.
        </Text>
      </Container>
    </Body>
  </Html>
)

const Row = ({ label, value }: { label: string; value: string }) => (
  <table style={rowTable}>
    <tbody>
      <tr>
        <td style={rowLabel}>{label}</td>
        <td style={rowValue}>{value}</td>
      </tr>
    </tbody>
  </table>
)

export const template = {
  component: SubscriptionConfirmedEmail,
  subject: 'Your subscription is confirmed',
  displayName: 'Subscription confirmed',
  previewData: {
    customerName: 'Alex',
    sku: 'RES-PRO-M',
    app: 'Resonance',
    tier: 'Pro',
    amountZar: 'R 149.00',
    renewalDate: '27 June 2026',
  },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: 'Inter, Arial, sans-serif' }
const container = { padding: '32px 28px', maxWidth: '560px', margin: '0 auto' }
const header = { marginBottom: '24px' }
const brandHeading = {
  fontSize: '14px',
  letterSpacing: '0.18em',
  textTransform: 'uppercase' as const,
  color: BRAND,
  margin: 0,
  fontWeight: 700,
}
const h1 = {
  fontSize: '26px',
  fontWeight: 700,
  color: '#0b0b14',
  margin: '0 0 16px',
}
const text = { fontSize: '15px', color: '#3a3a45', lineHeight: '1.55', margin: '0 0 24px' }
const card = {
  border: '1px solid #ececf2',
  borderRadius: '12px',
  padding: '8px 16px',
  backgroundColor: '#fafaff',
}
const rowTable = { width: '100%', borderCollapse: 'collapse' as const, margin: '8px 0' }
const rowLabel = { fontSize: '13px', color: '#6b6b75', padding: '6px 0', width: '40%' }
const rowValue = { fontSize: '14px', color: '#0b0b14', padding: '6px 0', fontWeight: 600 }
const hr = { borderTop: '1px solid #ececf2', margin: '28px 0 16px' }
const footer = { fontSize: '12px', color: '#8a8a95', margin: 0, lineHeight: '1.5' }
