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

interface CriticalAlertProps {
  eventLabel?: string
  summary?: string
  actionType?: string | null
  provider?: string | null
  actor?: string | null
  decisionUrl?: string | null
}

const CriticalAlertEmail = ({
  eventLabel = 'Control system alert',
  summary = '',
  actionType = null,
  provider = null,
  actor = null,
  decisionUrl = null,
}: CriticalAlertProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>{eventLabel} — NazAI Control System</Preview>
    <Body style={main}>
      <Container style={container}>
        <Section style={brandBar}>
          <Text style={brandMark}>
            Naz<span style={brandAccent}>AI</span> Control System
          </Text>
        </Section>
        <Section style={card}>
          <Heading style={h1}>{eventLabel}</Heading>
          <Text style={bodyText}>{summary}</Text>

          {actionType && (
            <Text style={detailLine}>
              Action: <span style={mono}>{actionType}</span>
              {provider ? ` · ${provider}` : ''}
            </Text>
          )}
          {actor && <Text style={detailLine}>By: {actor}</Text>}

          <Hr style={hr} />
          <Text style={sentReason}>
            This landed in your inbox because Slack isn't connected (or the
            Slack delivery failed) for your NazAI account — critical control-system
            alerts always get a channel, even without Slack.
          </Text>
          {decisionUrl && (
            <Button style={button} href={decisionUrl}>
              View decision record
            </Button>
          )}
        </Section>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: CriticalAlertEmail,
  subject: (data: Record<string, any>) => `🚨 ${data?.eventLabel || 'Control system alert'} — NazAI`,
  displayName: 'Critical alert (Slack fallback)',
  previewData: {
    eventLabel: '🛑 Kill switch auto-tripped',
    summary: 'The daily AI spend cap was exceeded, so the kill switch was automatically turned on for this account.',
    actionType: 'send_email',
    provider: 'Gmail',
    actor: null,
    decisionUrl: 'https://www.nazai.net/control-system',
  },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: 'Inter, Arial, sans-serif' }
const container = { padding: '24px 20px', maxWidth: '560px', margin: '0 auto' }
const brandBar = { paddingBottom: '12px' }
const brandMark = { fontSize: '18px', fontWeight: 700, color: '#0a0a0a', margin: 0 }
const brandAccent = { color: '#00A3FF' }
const card = { padding: '20px', backgroundColor: '#450a0a', borderRadius: '10px', borderLeft: '4px solid #f87171' }
const h1 = { color: '#ffffff', fontSize: '20px', margin: '0 0 12px 0' }
const bodyText = { color: '#fecaca', fontSize: '14px', lineHeight: '20px', margin: '0 0 12px 0' }
const detailLine = { color: '#fca5a5', fontSize: '13px', margin: '0 0 4px 0' }
const mono = { fontFamily: 'monospace' }
const hr = { borderColor: '#7f1d1d', margin: '16px 0' }
const sentReason = { color: '#fca5a5', fontSize: '12px', lineHeight: '18px', margin: '0 0 12px 0' }
const button = { backgroundColor: '#f87171', color: '#450a0a', fontSize: '13px', fontWeight: 700, borderRadius: '8px', padding: '10px 18px', textDecoration: 'none' }
