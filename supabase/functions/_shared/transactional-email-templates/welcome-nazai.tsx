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
  Link,
  Preview,
  Section,
  Text,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

const SITE_NAME = 'NazAI'
const APP_URL = 'https://nazai.net'

interface WelcomeNazaiProps {
  name?: string
}

const WelcomeNazaiEmail = ({ name }: WelcomeNazaiProps) => {
  const greeting = name ? `Welcome, ${name}` : 'Welcome to NazAI'
  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>Your AI Business Co-Founder is ready — launch a real business in minutes.</Preview>
      <Body style={main}>
        <Container style={container}>
          {/* Header / Brand bar */}
          <Section style={brandBar}>
            <Text style={brandMark}>
              Naz<span style={brandAccent}>AI</span>
            </Text>
          </Section>

          <Section style={card}>
            <Heading style={h1}>{greeting}</Heading>
            <Text style={lead}>
              Your AI Business Co-Founder is ready. NazAI helps you go from idea to a
              real, launched online business in minutes — strategy, brand, website,
              and content, all generated and orchestrated by intelligent agents.
            </Text>

            <Section style={ctaWrap}>
              <Button href={`${APP_URL}/dashboard`} style={ctaButton}>
                Open your workspace →
              </Button>
            </Section>

            <Hr style={divider} />

            <Heading as="h2" style={h2}>
              What you can do right now
            </Heading>

            <Section style={featureRow}>
              <Text style={featureTitle}>1. Generate a complete business</Text>
              <Text style={featureBody}>
                Describe your idea once. NazAI builds a niche, brand, and website in a single flow.
              </Text>
            </Section>

            <Section style={featureRow}>
              <Text style={featureTitle}>2. Launch with a real preview</Text>
              <Text style={featureBody}>
                Iterate live with the Iteration Bar and switch Comfort Designs to match your style.
              </Text>
            </Section>

            <Section style={featureRow}>
              <Text style={featureTitle}>3. Personalize NazAI</Text>
              <Text style={featureBody}>
                Set Personal Context and switch Visual Themes from your Workspace menu.
              </Text>
            </Section>

            <Hr style={divider} />

            <Text style={footnote}>
              You started with <strong>3 free credits</strong>. Each generation uses 1 credit —
              refill anytime from the sidebar.
            </Text>

            <Section style={ctaWrap}>
              <Button href={`${APP_URL}/dashboard`} style={ctaButtonSecondary}>
                Start your first project
              </Button>
            </Section>
          </Section>

          <Section style={footerWrap}>
            <Text style={footerText}>
              Need help? Reply to this email or visit{' '}
              <Link href={APP_URL} style={footerLink}>
                nazai.net
              </Link>
              .
            </Text>
            <Text style={footerSmall}>
              © {new Date().getFullYear()} {SITE_NAME}. Built for founders who move fast.
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  )
}

export const template = {
  component: WelcomeNazaiEmail,
  subject: 'Welcome to NazAI — Your AI Business Co-Founder is Ready',
  displayName: 'Welcome to NazAI',
  previewData: { name: 'Founder' },
} satisfies TemplateEntry

// ───────── Styles (inline for email-client compatibility) ─────────
const main: React.CSSProperties = {
  backgroundColor: '#ffffff',
  fontFamily:
    "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Inter', Arial, sans-serif",
  margin: 0,
  padding: '32px 16px',
}

const container: React.CSSProperties = {
  maxWidth: '560px',
  margin: '0 auto',
}

const brandBar: React.CSSProperties = {
  textAlign: 'center' as const,
  paddingBottom: '20px',
}

const brandMark: React.CSSProperties = {
  fontSize: '22px',
  fontWeight: 800,
  letterSpacing: '-0.02em',
  color: '#0a0a0a',
  margin: 0,
}

const brandAccent: React.CSSProperties = {
  background: 'linear-gradient(90deg, #00A3FF, #22c55e)',
  WebkitBackgroundClip: 'text',
  WebkitTextFillColor: 'transparent',
  backgroundClip: 'text',
  color: '#00A3FF',
}

const card: React.CSSProperties = {
  background: '#ffffff',
  border: '1px solid #ececef',
  borderRadius: '14px',
  padding: '36px 32px',
  boxShadow: '0 1px 2px rgba(10,10,10,0.04)',
}

const h1: React.CSSProperties = {
  fontSize: '26px',
  fontWeight: 700,
  color: '#0a0a0a',
  margin: '0 0 14px',
  lineHeight: 1.2,
  letterSpacing: '-0.02em',
}

const h2: React.CSSProperties = {
  fontSize: '15px',
  fontWeight: 700,
  color: '#0a0a0a',
  margin: '8px 0 12px',
  textTransform: 'uppercase' as const,
  letterSpacing: '0.06em',
}

const lead: React.CSSProperties = {
  fontSize: '15px',
  lineHeight: 1.65,
  color: '#3f3f46',
  margin: '0 0 24px',
}

const ctaWrap: React.CSSProperties = {
  textAlign: 'center' as const,
  margin: '8px 0 8px',
}

const ctaButton: React.CSSProperties = {
  background: '#0a0a0a',
  color: '#ffffff',
  padding: '14px 28px',
  borderRadius: '10px',
  fontSize: '14px',
  fontWeight: 600,
  textDecoration: 'none',
  display: 'inline-block',
}

const ctaButtonSecondary: React.CSSProperties = {
  background: '#ffffff',
  color: '#0a0a0a',
  padding: '12px 24px',
  borderRadius: '10px',
  fontSize: '13px',
  fontWeight: 600,
  textDecoration: 'none',
  display: 'inline-block',
  border: '1px solid #d4d4d8',
}

const divider: React.CSSProperties = {
  borderColor: '#ececef',
  margin: '28px 0',
}

const featureRow: React.CSSProperties = {
  margin: '0 0 14px',
}

const featureTitle: React.CSSProperties = {
  fontSize: '14px',
  fontWeight: 600,
  color: '#0a0a0a',
  margin: '0 0 4px',
}

const featureBody: React.CSSProperties = {
  fontSize: '13.5px',
  lineHeight: 1.6,
  color: '#52525b',
  margin: 0,
}

const footnote: React.CSSProperties = {
  fontSize: '13px',
  color: '#52525b',
  background: '#fafafa',
  border: '1px solid #ececef',
  borderRadius: '10px',
  padding: '12px 14px',
  margin: '0 0 18px',
}

const footerWrap: React.CSSProperties = {
  textAlign: 'center' as const,
  padding: '24px 8px 8px',
}

const footerText: React.CSSProperties = {
  fontSize: '12.5px',
  color: '#71717a',
  margin: '0 0 6px',
}

const footerLink: React.CSSProperties = {
  color: '#00A3FF',
  textDecoration: 'none',
  fontWeight: 600,
}

const footerSmall: React.CSSProperties = {
  fontSize: '11.5px',
  color: '#a1a1aa',
  margin: 0,
}
