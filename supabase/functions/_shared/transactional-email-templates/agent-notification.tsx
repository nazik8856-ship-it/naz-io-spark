/// <reference types="npm:@types/react@18.3.1" />
import * as React from 'npm:react@18.3.1'
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
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

interface AgentNotificationProps {
  subject?: string
  body?: string
  agentName?: string
}

const AgentNotificationEmail = ({ subject, body, agentName }: AgentNotificationProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>{subject || 'Update from your NazAI agent'}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Section style={brandBar}>
          <Text style={brandMark}>
            Naz<span style={brandAccent}>AI</span>
          </Text>
        </Section>
        <Section style={card}>
          <Heading style={h1}>{subject || 'Agent update'}</Heading>
          {agentName ? <Text style={meta}>From: {agentName}</Text> : null}
          <Hr style={hr} />
          {(body || '').split(/\n\n+/).map((para, i) => (
            <Text key={i} style={paragraph}>{para}</Text>
          ))}
        </Section>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: AgentNotificationEmail,
  subject: (data: Record<string, any>) => data?.subject || 'Update from your NazAI agent',
  displayName: 'Agent notification',
  previewData: { subject: 'Cashflow update', body: 'Your overdue invoices dropped 40% this week.', agentName: 'Cashflow Agent' },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: 'Inter, Arial, sans-serif' }
const container = { padding: '24px 20px', maxWidth: '560px', margin: '0 auto' }
const brandBar = { paddingBottom: '12px' }
const brandMark = { fontSize: '18px', fontWeight: 700, color: '#0a0a0a', margin: 0 }
const brandAccent = { color: '#00A3FF' }
const card = { padding: '20px', backgroundColor: '#0a0a0a', borderRadius: '10px' }
const h1 = { color: '#ffffff', fontSize: '20px', margin: '0 0 8px 0' }
const meta = { color: '#a1a1aa', fontSize: '12px', margin: '0 0 12px 0' }
const hr = { borderColor: '#27272a', margin: '12px 0' }
const paragraph = { color: '#e4e4e7', fontSize: '14px', lineHeight: '22px', margin: '0 0 12px 0' }
