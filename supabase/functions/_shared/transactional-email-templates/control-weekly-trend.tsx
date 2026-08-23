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

type TrendProps = { current?: number; previous?: number; changePct?: number; direction?: 'up' | 'down' | 'flat' }

interface WeeklyTrendProps {
  decisions?: TrendProps
  escalationRatePct?: TrendProps
  spendUsd?: TrendProps
  gateLatencyMs?: TrendProps
  controlSystemUrl?: string
}

const arrow = (direction?: string) => (direction === 'up' ? '↑' : direction === 'down' ? '↓' : '→')

const TrendLine = ({ label, t, unit = '' }: { label: string; t?: TrendProps; unit?: string }) => (
  <Text style={row}>
    {label}: <span style={strong}>{t?.current ?? 0}{unit}</span>{' '}
    <span style={{ color: t?.direction === 'up' ? '#f59e0b' : t?.direction === 'down' ? '#34d399' : '#a1a1aa' }}>
      {arrow(t?.direction)} {t?.changePct ?? 0}%
    </span>{' '}
    vs last week ({t?.previous ?? 0}{unit})
  </Text>
)

const WeeklyTrendEmail = ({ decisions, escalationRatePct, spendUsd, gateLatencyMs, controlSystemUrl = 'https://www.nazai.net/control-system/health' }: WeeklyTrendProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Your weekly NazAI Control System trend summary</Preview>
    <Body style={main}>
      <Container style={container}>
        <Section style={brandBar}>
          <Text style={brandMark}>
            Naz<span style={brandAccent}>AI</span> Control System
          </Text>
        </Section>
        <Section style={card}>
          <Heading style={h1}>This week vs last week</Heading>
          <TrendLine label="Decisions" t={decisions} />
          <TrendLine label="Escalation rate" t={escalationRatePct} unit="%" />
          <TrendLine label="AI spend" t={spendUsd} unit=" USD" />
          {/* Hidden when there's no timed decision in either week (gate_duration_ms
              is a recent addition -- some orgs/weeks genuinely have nothing to show). */}
          {((gateLatencyMs?.current ?? 0) > 0 || (gateLatencyMs?.previous ?? 0) > 0) && (
            <TrendLine label="Gate latency (avg)" t={gateLatencyMs} unit="ms" />
          )}
          <Hr style={hr} />
          <Button style={button} href={controlSystemUrl}>
            View control-plane health
          </Button>
        </Section>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: WeeklyTrendEmail,
  subject: () => 'Your weekly NazAI Control System trend summary',
  displayName: 'Weekly trend summary',
  previewData: {
    decisions: { current: 42, previous: 30, changePct: 40, direction: 'up' },
    escalationRatePct: { current: 8, previous: 12, changePct: -33.3, direction: 'down' },
    spendUsd: { current: 3.2, previous: 4.1, changePct: -22, direction: 'down' },
    gateLatencyMs: { current: 180, previous: 210, changePct: -14.3, direction: 'down' },
  },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: 'Inter, Arial, sans-serif' }
const container = { padding: '24px 20px', maxWidth: '560px', margin: '0 auto' }
const brandBar = { paddingBottom: '12px' }
const brandMark = { fontSize: '18px', fontWeight: 700, color: '#0a0a0a', margin: 0 }
const brandAccent = { color: '#00A3FF' }
const card = { padding: '20px', backgroundColor: '#0a0a0a', borderRadius: '10px' }
const h1 = { color: '#ffffff', fontSize: '20px', margin: '0 0 12px 0' }
const row = { color: '#e4e4e7', fontSize: '14px', lineHeight: '22px', margin: '0 0 8px 0' }
const strong = { color: '#ffffff', fontWeight: 700 }
const hr = { borderColor: '#27272a', margin: '16px 0' }
const button = { backgroundColor: '#00A3FF', color: '#0a0a0a', fontSize: '13px', fontWeight: 700, borderRadius: '8px', padding: '10px 18px', textDecoration: 'none' }
