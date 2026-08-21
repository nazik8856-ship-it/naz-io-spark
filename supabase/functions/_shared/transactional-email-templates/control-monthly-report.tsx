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

interface ComplianceSummary {
  passRatePct: number | null
  openIncidents: number
  resolvedIncidents: number
  settingsChanges: number
}

interface RoiSummary {
  total: number
  blocked: number
  modified: number
  autonomous: number
  needsHuman: number
  spendUsd: number
  costPerDecision: number | null
}

interface MonthlyReportProps {
  monthLabel?: string
  compliance?: ComplianceSummary | null
  roi?: RoiSummary | null
  controlSystemUrl?: string
}

const MonthlyReportEmail = ({
  monthLabel = 'last month',
  compliance,
  roi,
  controlSystemUrl = 'https://www.nazai.net/control-system',
}: MonthlyReportProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Your {monthLabel} NazAI Control System report</Preview>
    <Body style={main}>
      <Container style={container}>
        <Section style={brandBar}>
          <Text style={brandMark}>
            Naz<span style={brandAccent}>AI</span> Control System
          </Text>
        </Section>
        <Section style={card}>
          <Heading style={h1}>{monthLabel} summary</Heading>

          {compliance && (
            <>
              <Text style={sectionLabel}>Compliance</Text>
              <Text style={row}>Self-audit pass rate: <span style={strong}>{compliance.passRatePct ?? '—'}{compliance.passRatePct !== null ? '%' : ''}</span></Text>
              <Text style={row}>Incidents opened: <span style={strong}>{compliance.openIncidents}</span> · resolved: <span style={strong}>{compliance.resolvedIncidents}</span></Text>
              <Text style={row}>Settings changes: <span style={strong}>{compliance.settingsChanges}</span></Text>
              <Hr style={hr} />
            </>
          )}

          {roi && (
            <>
              <Text style={sectionLabel}>ROI</Text>
              <Text style={row}>{roi.total} actions reviewed — <span style={strong}>{roi.blocked + roi.modified}</span> blocked or modified</Text>
              <Text style={row}><span style={strong}>{roi.autonomous}</span> handled without a human, {roi.needsHuman} needed review</Text>
              <Text style={row}>AI spend: <span style={strong}>${roi.spendUsd.toFixed(2)}</span>{roi.costPerDecision !== null ? ` · $${roi.costPerDecision.toFixed(4)} per autonomous decision` : ''}</Text>
              <Hr style={hr} />
            </>
          )}

          <Button style={button} href={controlSystemUrl}>
            View full reports
          </Button>
        </Section>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: MonthlyReportEmail,
  subject: (data: Record<string, unknown>) => `Your ${data.monthLabel ?? 'monthly'} NazAI Control System report`,
  displayName: 'Monthly compliance/ROI report',
  previewData: {
    monthLabel: 'August 2026',
    compliance: { passRatePct: 100, openIncidents: 1, resolvedIncidents: 3, settingsChanges: 5 },
    roi: { total: 420, blocked: 12, modified: 8, autonomous: 380, needsHuman: 40, spendUsd: 4.32, costPerDecision: 0.0114 },
  },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: 'Inter, Arial, sans-serif' }
const container = { padding: '24px 20px', maxWidth: '560px', margin: '0 auto' }
const brandBar = { paddingBottom: '12px' }
const brandMark = { fontSize: '18px', fontWeight: 700, color: '#0a0a0a', margin: 0 }
const brandAccent = { color: '#00A3FF' }
const card = { padding: '20px', backgroundColor: '#0a0a0a', borderRadius: '10px' }
const h1 = { color: '#ffffff', fontSize: '20px', margin: '0 0 12px 0' }
const sectionLabel = { color: '#00A3FF', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.05em', margin: '0 0 6px 0' }
const row = { color: '#e4e4e7', fontSize: '14px', lineHeight: '22px', margin: '0 0 8px 0' }
const strong = { color: '#ffffff', fontWeight: 700 }
const hr = { borderColor: '#27272a', margin: '16px 0' }
const button = { backgroundColor: '#00A3FF', color: '#0a0a0a', fontSize: '13px', fontWeight: 700, borderRadius: '8px', padding: '10px 18px', textDecoration: 'none' }
