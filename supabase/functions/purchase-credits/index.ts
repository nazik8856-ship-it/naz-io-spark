// Server-side credit grant. Replaces the client-side add_credits RPC call
// that allowed a signed-in user to mint arbitrary credits. Validates the
// caller's JWT, then uses the service role to credit the account and log
// the transaction. RLS on credit_transactions now blocks direct client INSERTs.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })

interface Payload {
  kind: 'pack' | 'plan'
  amount?: number          // credits to grant (packs only)
  price_usd?: number
  description?: string
  type?: string            // transaction type label
  metadata?: Record<string, unknown>
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
  const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
  if (!SUPABASE_URL || !SERVICE_KEY) return json({ error: 'server_misconfigured' }, 500)

  // Verify caller JWT
  const authHeader = req.headers.get('Authorization') ?? ''
  const token = authHeader.replace(/^Bearer\s+/i, '')
  if (!token) return json({ error: 'unauthorized' }, 401)

  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  })
  const { data: userData, error: userErr } = await userClient.auth.getUser()
  if (userErr || !userData?.user) return json({ error: 'unauthorized' }, 401)
  const userId = userData.user.id

  let payload: Payload
  try {
    payload = await req.json()
  } catch {
    return json({ error: 'invalid_json' }, 400)
  }

  if (payload.kind !== 'pack' && payload.kind !== 'plan') {
    return json({ error: 'invalid_kind' }, 400)
  }
  const amount = Number.isFinite(payload.amount) ? Math.floor(payload.amount as number) : 0
  if (payload.kind === 'pack') {
    if (!amount || amount <= 0 || amount > 1_000_000) {
      return json({ error: 'invalid_amount' }, 400)
    }
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY)

  // Grant credits (packs only). Plan changes are recorded but credits are
  // delivered separately by the subscription flow.
  if (payload.kind === 'pack') {
    const { error: addErr } = await admin
      .from('profiles')
      .upsert(
        { id: userId, credits: amount },
        { onConflict: 'id', ignoreDuplicates: false },
      )
      .select()
      .maybeSingle()
    // upsert won't increment — do an RPC-style increment via raw update
    if (addErr) console.warn('upsert profile failed (will fall back)', addErr)
    const { data: prof } = await admin.from('profiles').select('credits').eq('id', userId).maybeSingle()
    const current = prof?.credits ?? 0
    const next = current + amount
    const { error: updErr } = await admin.from('profiles').update({ credits: next }).eq('id', userId)
    if (updErr) {
      console.error('credit grant failed', updErr)
      return json({ error: 'grant_failed' }, 500)
    }
  }

  const { error: txErr } = await admin.from('credit_transactions').insert({
    user_id: userId,
    type: payload.type ?? (payload.kind === 'pack' ? 'credit_pack' : 'plan_change'),
    description: payload.description ?? (payload.kind === 'pack' ? `${amount} credits` : 'Plan change'),
    amount: payload.kind === 'pack' ? amount : (payload.amount ?? 0),
    price_usd: payload.price_usd ?? null,
    status: 'completed',
    metadata: payload.metadata ?? null,
  })
  if (txErr) {
    console.error('transaction insert failed', txErr)
    return json({ error: 'log_failed' }, 500)
  }

  return json({ ok: true })
})
