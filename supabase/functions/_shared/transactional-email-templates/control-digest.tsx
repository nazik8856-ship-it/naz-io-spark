/// <reference types="npm:@types/react@18.3.1" />
import * as React from 'npm:react@18.3.1'
import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Preview,
  Section,
  Text,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

interface ControlDigestProps {
  openIncidents?: number
  incidentSummaries?: string[]
  pendingApprovals?: number
  oldestPendingHours?: number
  spendPct?: number
  spendUsd?: number
  capUsd?: number
  controlSystemUrl?: string
}

const ControlDigestEmail = ({
  openIncidents = 0,
  incidentSummaries = [],
  pendingApprovals = 0,
  oldestPendingHours = 0,
  spendPct = 0,
  spendUsd = 0,
  capUsd = 0,
  controlSystemUrl = 'https://www.nazai.net/control-system',
}: ControlDigestProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>
      {openIncidents > 0
        ? `${openIncidents} open incident${openIncidents === 1 ? '' : 's'} — daily control-system digest`
        : 'Your daily NazAI control-system digest'}
    </Preview>
    <Body style={main}>
      <Container style={container}>
        <Section style={brandBar}>
          <Text style={brandMark}>
            Naz<span style={brandAccent}>AI</span> Control System
          </Text>
        </Section>
        <Section style={card}>
          <Heading style={h1}>Daily digest</Heading>

          {openIncidents > 0 && (
            <>
              <Text style={sectionLabel}>⏰ {openIncidents} open incident{openIncidents === 1 ? '' : 's'}</Text>
              {incidentSummaries.slice(0, 5).map((s, i) => (
                <Text key={i} style={listItem}>• {s}</Text>
              ))}
            </>
          )}

          {pendingApprovals > 0 && (
            <>
              <Text style={sectionLabel}>
                🕐 {pendingApprovals} pending approval{pendingApprovals === 1 ? '' : 's'}
                {oldestPendingHours > 0 ? ` — oldest waiting ${Math.round(oldestPendingHours)}h` : ''}
              </Text>
            </>
          )}

          {spendPct >= 80 && (
            <Text style={sectionLabel}>
              💸 AI spend at {spendPct}% of today's cap (${spendUsd.toFixed(2)} of ${capUsd.toFixed(2)})
            </Text>
          )}

          <Hr style={hr} />
          <Button style={button} href={controlSystemUrl}>
            Open Control System
          </Button>
        </Section>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: ControlDigestEmail,
  subject: (data: Record<string, any>) =>
    data?.openIncidents > 0
      ? `${data.openIncidents} open incident${data.openIncidents === 1 ? '' : 's'} — NazAI Control System`
      : 'Your daily NazAI Control System digest',
  displayName: 'Control system daily digest',
  previewData: {
    openIncidents: 2,
    incidentSummaries: ['Circuit breaker tripped for send_email', 'Gate error on slack_post_message'],
    pendingApprovals: 3,
    oldestPendingHours: 14,
    spendPct: 62,
    spendUsd: 3.1,
    capUsd: 5,
  },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: 'Inter, Arial, sans-serif' }
const container = { padding: '24px 20px', maxWidth: '560px', margin: '0 auto' }
const brandBar = { paddingBottom: '12px' }
const brandMark = { fontSize: '18px', fontWeight: 700, color: '#0a0a0a', margin: 0 }
const brandAccent = { color: '#00A3FF' }
const card = { padding: '20px', backgroundColor: '#0a0a0a', borderRadius: '10px' }
const h1 = { color: '#ffffff', fontSize: '20px', margin: '0 0 12px 0' }
const sectionLabel = { color: '#f4f4f5', fontSize: '14px', fontWeight: 600, margin: '16px 0 4px 0' }
const listItem = { color: '#a1a1aa', fontSize: '13px', lineHeight: '20px', margin: '0 0 2px 0' }
const hr = { borderColor: '#27272a', margin: '16px 0' }
const button = { backgroundColor: '#00A3FF', color: '#0a0a0a', fontSize: '13px', fontWeight: 700, borderRadius: '8px', padding: '10px 18px', textDecoration: 'none' }
