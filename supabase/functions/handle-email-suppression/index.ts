// Retired. Email sending moved from Lovable's hosted email API to Resend
// directly (see process-email-queue), so bounce/complaint suppression
// events now arrive from Resend's own webhook instead of being forwarded
// by Lovable's Go service through here — see resend-events/index.ts's
// recordSuppression(), which does the same suppressed_emails/email_send_log
// writes this function used to do.
//
// Left deployed (rather than deleted) so any traffic still arriving at this
// URL gets a clear, intentional response instead of an obscure key error.
function jsonResponse(data: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }
  return jsonResponse(
    { error: 'This endpoint has been retired. Bounce/complaint suppression is now handled by resend-events.' },
    410,
  )
})
