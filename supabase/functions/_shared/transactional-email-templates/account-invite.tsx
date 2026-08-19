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

interface AccountInviteProps {
  inviterEmail?: string
  role?: string
  acceptUrl?: string
}

const AccountInviteEmail = ({ inviterEmail, role, acceptUrl = 'https://www.nazai.net/team/accept' }: AccountInviteProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>{`${inviterEmail || 'Someone'} invited you to their NazAI Control System team`}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Section style={brandBar}>
          <Text style={brandMark}>
            Naz<span style={brandAccent}>AI</span>
          </Text>
        </Section>
        <Section style={card}>
          <Heading style={h1}>You've been invited</Heading>
          <Text style={paragraph}>
            {inviterEmail || 'Someone'} invited you to join their NazAI Control System team as{' '}
            <span style={strong}>{role || 'a member'}</span>.
          </Text>
          <Hr style={hr} />
          <Button style={button} href={acceptUrl}>
            Accept invitation
          </Button>
        </Section>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: AccountInviteEmail,
  subject: (data: Record<string, any>) => `${data?.inviterEmail || 'Someone'} invited you to their NazAI team`,
  displayName: 'Account team invite',
  previewData: { inviterEmail: 'owner@example.com', role: 'approver', acceptUrl: 'https://www.nazai.net/team/accept?token=demo' },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: 'Inter, Arial, sans-serif' }
const container = { padding: '24px 20px', maxWidth: '560px', margin: '0 auto' }
const brandBar = { paddingBottom: '12px' }
const brandMark = { fontSize: '18px', fontWeight: 700, color: '#0a0a0a', margin: 0 }
const brandAccent = { color: '#00A3FF' }
const card = { padding: '20px', backgroundColor: '#0a0a0a', borderRadius: '10px' }
const h1 = { color: '#ffffff', fontSize: '20px', margin: '0 0 8px 0' }
const paragraph = { color: '#e4e4e7', fontSize: '14px', lineHeight: '22px', margin: '0 0 12px 0' }
const strong = { color: '#ffffff', fontWeight: 700 }
const hr = { borderColor: '#27272a', margin: '16px 0' }
const button = { backgroundColor: '#00A3FF', color: '#0a0a0a', fontSize: '13px', fontWeight: 700, borderRadius: '8px', padding: '10px 18px', textDecoration: 'none' }
