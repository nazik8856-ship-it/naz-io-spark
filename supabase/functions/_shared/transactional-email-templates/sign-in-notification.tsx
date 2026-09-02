/// <reference types="npm:@types/react@18.3.1" />
import * as React from 'npm:react@18.3.1'
import {
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
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

const SITE_NAME = 'NazAI'
const APP_URL = 'https://nazai.net'

interface SignInNotificationProps {
  email?: string
  method?: 'password' | 'google' | 'apple'
  timestamp?: string
}

const METHOD_LABEL: Record<string, string> = {
  password: 'your email and password',
  google: 'Google',
  apple: 'Apple',
}

const SignInNotificationEmail = ({ email, method = 'password', timestamp }: SignInNotificationProps) => {
  const when = timestamp
    ? new Date(timestamp).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }) + ' UTC'
    : 'just now'
  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>You signed in to NazAI using {METHOD_LABEL[method] ?? method}.</Preview>
      <Body style={main}>
        <Container style={container}>
          <Section style={brandBar}>
            <Text style={brandMark}>
              Naz<span style={brandAccent}>AI</span>
            </Text>
          </Section>

          <Section style={card}>
            <Heading style={h1}>New sign-in to your account</Heading>
            <Text style={lead}>
              {email ? <>The account <strong>{email}</strong> was</> : 'Your account was'} just signed in to NazAI
              using {METHOD_LABEL[method] ?? method}.
            </Text>
            <Text style={detailLine}>Time: {when}</Text>

            <Hr style={divider} />

            <Text style={footnote}>
              Wasn't you? <Link href={`${APP_URL}/`} style={footerLink}>Reset your password</Link> right away to
              secure your account.
            </Text>
          </Section>

          <Section style={footerWrap}>
            <Text style={footerSmall}>
              © {new Date().getFullYear()} {SITE_NAME}. This is a security notice sent on every sign-in.
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  )
}

export const template = {
  component: SignInNotificationEmail,
  subject: 'You signed in to NazAI',
  displayName: 'Sign-in notification',
  previewData: { email: 'founder@example.com', method: 'password', timestamp: new Date().toISOString() },
} satisfies TemplateEntry

// ───────── Styles (inline for email-client compatibility) ─────────
const main: React.CSSProperties = {
  backgroundColor: '#ffffff',
  fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Inter', Arial, sans-serif",
  margin: 0,
  padding: '32px 16px',
}
const container: React.CSSProperties = { maxWidth: '560px', margin: '0 auto' }
const brandBar: React.CSSProperties = { textAlign: 'center' as const, paddingBottom: '20px' }
const brandMark: React.CSSProperties = { fontSize: '22px', fontWeight: 800, letterSpacing: '-0.02em', color: '#0a0a0a', margin: 0 }
const brandAccent: React.CSSProperties = { color: '#00A3FF' }
const card: React.CSSProperties = {
  background: '#ffffff',
  border: '1px solid #ececef',
  borderRadius: '14px',
  padding: '32px 28px',
  boxShadow: '0 1px 2px rgba(10,10,10,0.04)',
}
const h1: React.CSSProperties = { fontSize: '22px', fontWeight: 700, color: '#0a0a0a', margin: '0 0 14px', lineHeight: 1.2 }
const lead: React.CSSProperties = { fontSize: '15px', lineHeight: 1.65, color: '#3f3f46', margin: '0 0 8px' }
const detailLine: React.CSSProperties = { fontSize: '13px', color: '#71717a', margin: '0 0 4px' }
const divider: React.CSSProperties = { borderColor: '#ececef', margin: '24px 0' }
const footnote: React.CSSProperties = {
  fontSize: '13px',
  color: '#52525b',
  background: '#fafafa',
  border: '1px solid #ececef',
  borderRadius: '10px',
  padding: '12px 14px',
  margin: 0,
}
const footerLink: React.CSSProperties = { color: '#00A3FF', textDecoration: 'none', fontWeight: 600 }
const footerWrap: React.CSSProperties = { textAlign: 'center' as const, padding: '24px 8px 8px' }
const footerSmall: React.CSSProperties = { fontSize: '11.5px', color: '#a1a1aa', margin: 0 }
