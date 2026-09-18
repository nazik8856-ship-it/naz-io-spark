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

interface WebsiteLeadNotificationProps {
  siteName?: string
  sectionKind?: string
  pageSlug?: string
  fields?: Record<string, string>
}

const WebsiteLeadNotificationEmail = ({ siteName, sectionKind, pageSlug, fields }: WebsiteLeadNotificationProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>New {sectionKind || 'form'} submission on {siteName || 'your site'}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Section style={brandBar}>
          <Text style={brandMark}>
            Naz<span style={brandAccent}>AI</span>
          </Text>
        </Section>
        <Section style={card}>
          <Heading style={h1}>New submission on {siteName || 'your site'}</Heading>
          <Text style={meta}>
            {sectionKind || 'form'}{pageSlug ? ` · ${pageSlug} page` : ''}
          </Text>
          <Hr style={hr} />
          {Object.entries(fields || {}).map(([label, value]) => (
            <Text key={label} style={paragraph}>
              <strong>{label}:</strong> {value || '—'}
            </Text>
          ))}
        </Section>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: WebsiteLeadNotificationEmail,
  subject: (data: Record<string, any>) => `New ${data?.sectionKind || 'form'} submission on ${data?.siteName || 'your site'}`,
  displayName: 'Website lead notification',
  previewData: {
    siteName: 'Riverside Pilates',
    sectionKind: 'contact',
    pageSlug: 'home',
    fields: { Name: 'Jordan Lee', Email: 'jordan@example.com', Message: 'Do you have evening classes?' },
  },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: 'Inter, Arial, sans-serif' }
const container = { padding: '24px 20px', maxWidth: '560px', margin: '0 auto' }
const brandBar = { paddingBottom: '12px' }
const brandMark = { fontSize: '18px', fontWeight: 700, color: '#0a0a0a', margin: 0 }
const brandAccent = { color: '#00A3FF' }
const card = { padding: '20px', backgroundColor: '#0a0a0a', borderRadius: '10px' }
const h1 = { color: '#ffffff', fontSize: '20px', margin: '0 0 8px 0' }
const meta = { color: '#a1a1aa', fontSize: '12px', margin: '0 0 12px 0', textTransform: 'capitalize' as const }
const hr = { borderColor: '#27272a', margin: '12px 0' }
const paragraph = { color: '#e4e4e7', fontSize: '14px', lineHeight: '22px', margin: '0 0 8px 0' }
