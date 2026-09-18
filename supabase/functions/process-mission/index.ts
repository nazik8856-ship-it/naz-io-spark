import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { pickAiGateway, callAiGateway } from "../_shared/ai-gateway.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // Authenticate user
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing Authorization header' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    const token = authHeader.replace('Bearer ', '')
    const { data: { user } } = await supabaseClient.auth.getUser(token)
    if (!user) {
      return new Response(JSON.stringify({ error: 'Not authenticated' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Check credits
    const { data: profile } = await supabaseClient
      .from('profiles')
      .select('credits')
      .eq('id', user.id)
      .single()

    if (!profile || profile.credits <= 0) {
      return new Response(JSON.stringify({ error: "No credits remaining." }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Process directive with the AI gateway
    const { directive } = await req.json()
    const gw = pickAiGateway()
    if (!gw) throw new Error('Missing OPENAI_API_KEY (or LOVABLE_API_KEY)')

    const response = await callAiGateway({
      model: gw.model,
      messages: [
        {
          role: 'system',
          content: `You are a senior problem-solving AI. Analyze problems and return a JSON object with exactly these keys:
- "solution": A clear, actionable solution (2-3 sentences).
- "explanation": The reasoning behind it (2-3 sentences).
- "actions": An array of 3-5 short action steps (each under 5 words).

Return ONLY valid JSON. No markdown, no code fences.`
        },
        {
          role: 'user',
          content: directive
        }
      ],
    }, gw)

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded. Please try again shortly." }), {
          status: 429,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted. Please add funds." }), {
          status: 402,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
      const errText = await response.text()
      console.error('AI gateway error:', response.status, errText)
      throw new Error('AI gateway error')
    }

    const data = await response.json()
    const aiText = data.choices?.[0]?.message?.content

    if (!aiText) throw new Error('No response from AI')

    // Deduct credit
    await supabaseClient.rpc('deduct_credit', { user_id: user.id })

    // Parse and return
    let parsed
    try {
      const cleaned = aiText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
      parsed = JSON.parse(cleaned)
    } catch {
      parsed = { solution: aiText, explanation: '', actions: [] }
    }

    return new Response(JSON.stringify(parsed), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  } catch (error) {
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
