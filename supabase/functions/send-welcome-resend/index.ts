// Send the NazAI welcome email directly via Resend.
// This is a dedicated, always-on path used right after signup so users
// receive the welcome email reliably even before email confirmation.
//
// Auth: this function is configured with verify_jwt = false so it can be
// invoked from unauthenticated signup contexts (no session yet).

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')

// nazai.net is verified in Resend — send from the verified domain.
const FROM_ADDRESS = Deno.env.get('RESEND_FROM') || 'NazAI <onboarding@nazai.net>'
const APP_URL = 'https://nazai.net'

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function buildWelcomeHtml(name?: string): string {
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
    return new Response(JSON.stringify({ error: 'method_not_allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  if (!RESEND_API_KEY) {
    console.error('[send-welcome-resend] RESEND_API_KEY is not configured')
    return new Response(JSON.stringify({ error: 'resend_not_configured' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  let payload: { email?: string; name?: string } = {}
  try {
    payload = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: 'invalid_json' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const email = typeof payload.email === 'string' ? payload.email.trim() : ''
  const name = typeof payload.name === 'string' ? payload.name.trim() : ''

  if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
    return new Response(JSON.stringify({ error: 'invalid_email' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const html = buildWelcomeHtml(name || undefined)
  const subject = 'Welcome to NazAI 🚀'

  console.log(`📧 Sending welcome email to ${email} from ${FROM_ADDRESS}`)

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: FROM_ADDRESS,
        to: [email],
        subject,
        html,
      }),
    })

    const text = await res.text()
    if (!res.ok) {
      console.error(`❌ Failed to send welcome email to ${email} from ${FROM_ADDRESS} — status ${res.status}: ${text}`)
      return new Response(
        JSON.stringify({ error: 'resend_failed', status: res.status, body: text }),
        {
          status: 502,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      )
    }

    console.log(`✅ Welcome email sent successfully to ${email} from ${FROM_ADDRESS} — ${text}`)
    return new Response(JSON.stringify({ ok: true, body: text }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[send-welcome-resend] network error', { message })
    return new Response(
      JSON.stringify({ error: 'network_error', message }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  }
})