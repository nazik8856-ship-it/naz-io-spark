// Dedicated NazAI welcome email sender.
// Invoked immediately after successful signup so every new user gets the welcome email.

import { Resend } from 'npm:resend@6.1.3'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const resendApiKey = Deno.env.get('RESEND_API_KEY')
const resend = new Resend(resendApiKey)

const FROM_ADDRESS = Deno.env.get('RESEND_FROM') || 'NazAI <onboarding@nazai.net>'
const APP_URL = 'https://nazai.net'

type IncomingPayload = {
  user?: {
    email?: string | null
    user_metadata?: Record<string, unknown> | null
  } | null
  email?: string | null
  name?: string | null
}

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function buildWelcomeEmailHtml(name?: string): string {
  const safeName = name ? escapeHtml(name) : ''
  const greeting = safeName ? `Welcome, ${safeName}` : 'Welcome to NazAI'
  const year = new Date().getFullYear()

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Welcome to NazAI</title>
  </head>
  <body style="margin:0;padding:32px 16px;background:#ffffff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Inter',Arial,sans-serif;">
    <div style="max-width:560px;margin:0 auto;">
      <div style="text-align:center;padding-bottom:20px;">
        <p style="font-size:22px;font-weight:800;letter-spacing:-0.02em;color:#0a0a0a;margin:0;">
          Naz<span style="color:#00A3FF;">AI</span>
        </p>
      </div>

      <div style="background:#ffffff;border:1px solid #ececef;border-radius:14px;padding:36px 32px;box-shadow:0 1px 2px rgba(10,10,10,0.04);">
        <h1 style="font-size:26px;font-weight:700;color:#0a0a0a;margin:0 0 14px;line-height:1.2;letter-spacing:-0.02em;">
          ${greeting} 🚀
        </h1>
        <p style="font-size:15px;line-height:1.65;color:#3f3f46;margin:0 0 24px;">
          Your AI Business Co-Founder is ready. NazAI helps you go from idea to a real,
          launched online business in minutes — strategy, brand, website, and content,
          all generated and orchestrated by intelligent agents.
        </p>

        <div style="text-align:center;margin:8px 0;">
          <a href="${APP_URL}/dashboard" style="background:#0a0a0a;color:#ffffff;padding:14px 28px;border-radius:10px;font-size:14px;font-weight:600;text-decoration:none;display:inline-block;">
            Open NazAI Dashboard →
          </a>
        </div>

        <hr style="border:none;border-top:1px solid #ececef;margin:28px 0;" />

        <h2 style="font-size:15px;font-weight:700;color:#0a0a0a;margin:8px 0 12px;text-transform:uppercase;letter-spacing:0.06em;">
          What you can do right now
        </h2>

        <div style="margin:0 0 14px;">
          <p style="font-size:14px;font-weight:600;color:#0a0a0a;margin:0 0 4px;">1. Generate a complete business</p>
          <p style="font-size:13.5px;line-height:1.6;color:#52525b;margin:0;">
            Describe your idea once. NazAI builds a niche, brand, and website in a single flow.
          </p>
        </div>

        <div style="margin:0 0 14px;">
          <p style="font-size:14px;font-weight:600;color:#0a0a0a;margin:0 0 4px;">2. Launch with a real preview</p>
          <p style="font-size:13.5px;line-height:1.6;color:#52525b;margin:0;">
            Iterate live with the Iteration Bar and switch Comfort Designs to match your style.
          </p>
        </div>

        <div style="margin:0 0 14px;">
          <p style="font-size:14px;font-weight:600;color:#0a0a0a;margin:0 0 4px;">3. Personalize NazAI</p>
          <p style="font-size:13.5px;line-height:1.6;color:#52525b;margin:0;">
            Set Personal Context and switch Visual Themes from your Workspace menu.
          </p>
        </div>

        <hr style="border:none;border-top:1px solid #ececef;margin:28px 0;" />

        <p style="font-size:13px;color:#52525b;background:#fafafa;border:1px solid #ececef;border-radius:10px;padding:12px 14px;margin:0 0 18px;">
          You started with <strong>3 free credits</strong>. Each generation uses 1 credit — refill anytime from the sidebar.
        </p>

        <div style="text-align:center;margin:8px 0;">
          <a href="${APP_URL}/dashboard" style="background:#ffffff;color:#0a0a0a;padding:12px 24px;border-radius:10px;font-size:13px;font-weight:600;text-decoration:none;display:inline-block;border:1px solid #d4d4d8;">
            Start your first project
          </a>
        </div>
      </div>

      <div style="text-align:center;padding:24px 8px 8px;">
        <p style="font-size:12.5px;color:#71717a;margin:0 0 6px;">
          Need help? Reply to this email or visit
          <a href="${APP_URL}" style="color:#00A3FF;text-decoration:none;">nazai.net</a>.
        </p>
        <p style="font-size:11.5px;color:#a1a1aa;margin:0;">© ${year} NazAI. Built for founders who move fast.</p>
      </div>
    </div>
  </body>
</html>`
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'method_not_allowed' }, 405)
  }

  if (!resendApiKey) {
    console.error('❌ Welcome email failed: RESEND_API_KEY is not configured')
    return jsonResponse({ error: 'resend_api_key_missing' }, 500)
  }

  let payload: IncomingPayload
  try {
    payload = await req.json()
  } catch (error) {
    console.error('❌ Welcome email failed: invalid JSON body', error)
    return jsonResponse({ error: 'invalid_json' }, 400)
  }

  const userEmail = readString(payload.user?.email) || readString(payload.email)
  const userName =
    readString(payload.name) ||
    readString(payload.user?.user_metadata?.full_name) ||
    readString(payload.user?.user_metadata?.name)

  if (!userEmail) {
    console.error('❌ Welcome email failed: No email found in request body')
    return jsonResponse({ error: 'No email found' }, 400)
  }

  if (!/^\S+@\S+\.\S+$/.test(userEmail)) {
    console.error(`❌ Welcome email failed: invalid email ${userEmail}`)
    return jsonResponse({ error: 'invalid_email' }, 400)
  }

  console.log(`Sending welcome email to ${userEmail} from ${FROM_ADDRESS}`)

  try {
    const sendResult = await resend.emails.send({
      from: FROM_ADDRESS,
      to: userEmail,
      subject: 'Welcome to NazAI 🚀',
      html: buildWelcomeEmailHtml(userName),
    })

    if (sendResult.error) {
      console.error(`❌ Welcome email failed to send to ${userEmail}:`, sendResult.error)
      return jsonResponse({ error: 'resend_failed', details: sendResult.error }, 502)
    }

    console.log(`✅ Welcome email sent successfully to ${userEmail}`, sendResult.data)
    return jsonResponse({ success: true, id: sendResult.data?.id ?? null })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`❌ Welcome email failed to send to ${userEmail}:`, error)
    return jsonResponse({ error: message }, 500)
  }
})
