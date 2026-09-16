// Server-side credit grant. Replaces the client-side add_credits RPC call
// that allowed a signed-in user to mint arbitrary credits. Validates the
// caller's JWT, then uses the service role to credit the account and log
// the transaction. RLS on credit_transactions now blocks direct client INSERTs.
//
// The caller no longer supplies the amount/price to grant -- it previously
// sent an arbitrary `amount` (capped only at 1,000,000) straight through to
// the credit grant, so any signed-in user could call this endpoint directly
// with e.g. {kind:"pack", amount:1000000} and mint free credits with no
// relation to any real product. Now the caller names a real catalog item
// (packId / tierId) and the server looks up the actual credits/price from
// its own copy of the catalog -- mirrors src/lib/credit-packs.ts and
// src/lib/credit-tiers.ts exactly; keep both in sync if the catalog changes.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { checkRateLimit } from '../_shared/rate-limit.ts'

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

interface CreditPack {
  id: string
  credits: number
  bonus: number
  price: number
  salePrice: number
}

const CREDIT_PACKS: Record<string, CreditPack> = {
  'pack-300': { id: 'pack-300', credits: 300, bonus: 0, price: 4.99, salePrice: 3.99 },
  'pack-1000': { id: 'pack-1000', credits: 1_000, bonus: 100, price: 14.99, salePrice: 11.99 },
  'pack-2500': { id: 'pack-2500', credits: 2_500, bonus: 300, price: 24.99, salePrice: 19.99 },
  'pack-12000': { id: 'pack-12000', credits: 12_000, bonus: 1_000, price: 79.99, salePrice: 63.99 },
}

type TierId = 'explorer' | 'operator' | 'titan' | 'enterprise'

interface TierPlan {
  id: TierId
  monthlyCredits: number
  monthlyPrice: number
  annualPrice: number
}

const TIER_PLANS: Record<TierId, TierPlan> = {
  explorer: { id: 'explorer', monthlyCredits: 300, monthlyPrice: 0, annualPrice: 0 },
  operator: { id: 'operator', monthlyCredits: 2_500, monthlyPrice: 34, annualPrice: 25 },
  titan: { id: 'titan', monthlyCredits: 12_000, monthlyPrice: 119, annualPrice: 89 },
  enterprise: { id: 'enterprise', monthlyCredits: 0, monthlyPrice: 0, annualPrice: 0 },
}

// Same promo codes PaymentWindow.tsx offers -- mirrored here so the stored
// receipt's price_usd reflects a real discount instead of either trusting
// the client's own arithmetic or silently dropping the promo entirely.
const PROMOS: Record<string, number> = {
  NAZAI10: 0.10,
  LAUNCH20: 0.20,
  TITAN15: 0.15,
}

interface Payload {
  kind: 'pack' | 'plan'
  packId?: string
  tierId?: string
  annual?: boolean
  promoCode?: string
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

  const admin = createClient(SUPABASE_URL, SERVICE_KEY)

  // This is still a mock checkout (no real charge provider wired in yet),
  // but a per-user cooldown stops the endpoint from being grindable for
  // unlimited repeat "purchases" in a tight loop.
  const rate = await checkRateLimit(admin, userId, 'purchase-credits', 10, 3600)
  if (!rate.allowed) {
    return json({ error: 'rate_limited', message: `Too many purchase attempts — ${rate.count} in the last hour (limit ${rate.limit}).` }, 429)
  }

  let payload: Payload
  try {
    payload = await req.json()
  } catch {
    return json({ error: 'invalid_json' }, 400)
  }

  if (payload.kind !== 'pack' && payload.kind !== 'plan') {
    return json({ error: 'invalid_kind' }, 400)
  }

  const promoPct = payload.promoCode ? PROMOS[payload.promoCode.trim().toUpperCase()] ?? 0 : 0

  if (payload.kind === 'pack') {
    const pack = payload.packId ? CREDIT_PACKS[payload.packId] : undefined
    if (!pack) return json({ error: 'invalid_pack' }, 400)
    const amount = pack.credits + pack.bonus
    const priceUsd = +(pack.salePrice * (1 - promoPct)).toFixed(2)

    const { data: prof } = await admin.from('profiles').select('credits').eq('id', userId).maybeSingle()
    if (!prof) {
      const { error: insErr } = await admin.from('profiles').insert({ id: userId, credits: amount })
      if (insErr) {
        console.error('profile insert failed', insErr)
        return json({ error: 'grant_failed' }, 500)
      }
    } else {
      const next = (prof.credits ?? 0) + amount
      const { error: updErr } = await admin.from('profiles').update({ credits: next }).eq('id', userId)
      if (updErr) {
        console.error('credit grant failed', updErr)
        return json({ error: 'grant_failed' }, 500)
      }
    }

    const { error: txErr } = await admin.from('credit_transactions').insert({
      user_id: userId,
      type: 'credit_pack',
      description: `${amount} credits pack${payload.promoCode ? ` · ${payload.promoCode.trim().toUpperCase()}` : ''}`,
      amount,
      price_usd: priceUsd,
      status: 'completed',
      metadata: { ...(payload.metadata ?? {}), pack_id: pack.id },
    })
    if (txErr) {
      console.error('transaction insert failed', txErr)
      return json({ error: 'log_failed' }, 500)
    }

    return json({ ok: true, amount, price_usd: priceUsd })
  }

  // kind === 'plan'
  const tierId = payload.tierId as TierId | undefined
  const plan = tierId ? TIER_PLANS[tierId] : undefined
  if (!plan) return json({ error: 'invalid_tier' }, 400)

  const basePrice = payload.annual ? plan.annualPrice : plan.monthlyPrice
  const priceUsd = +(basePrice * (1 - promoPct)).toFixed(2)

  // The server is now the only writer of profiles.tier -- this is what
  // src/lib/feature-gates.ts's capability checks should ultimately be
  // resynced from, instead of trusting whatever a client wrote to its own
  // localStorage.
  const { error: tierErr } = await admin.from('profiles').upsert(
    { id: userId, tier: plan.id },
    { onConflict: 'id', ignoreDuplicates: false },
  )
  if (tierErr) {
    console.error('tier update failed', tierErr)
    return json({ error: 'grant_failed' }, 500)
  }

  const { error: txErr } = await admin.from('credit_transactions').insert({
    user_id: userId,
    type: 'plan_change',
    description: `Switched to ${plan.id} plan (${payload.annual ? 'annual' : 'monthly'})`,
    amount: plan.monthlyCredits,
    price_usd: priceUsd,
    status: 'completed',
    metadata: { ...(payload.metadata ?? {}), tier: plan.id, annual: !!payload.annual },
  })
  if (txErr) {
    console.error('transaction insert failed', txErr)
    return json({ error: 'log_failed' }, 500)
  }

  return json({ ok: true, tier: plan.id, price_usd: priceUsd })
})
