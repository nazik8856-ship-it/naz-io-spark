import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const { prompt, userId } = await req.json()
    if (!prompt || !userId) {
      return new Response(JSON.stringify({ error: 'Missing prompt or userId' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // Check credits
    const { data: profile } = await supabaseClient
      .from('profiles')
      .select('credits')
      .eq('id', userId)
      .single()

    if (!profile || profile.credits <= 0) {
      return new Response(JSON.stringify({ error: 'No credits remaining.' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Generate website via Lovable AI Gateway
    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY')
    if (!LOVABLE_API_KEY) throw new Error('LOVABLE_API_KEY is not configured')

    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          {
            role: 'system',
            content: `You are a world-class web developer. Generate a complete, self-contained HTML page with inline CSS and JavaScript based on the user's prompt. The page must be modern, responsive, and visually polished. Return ONLY the raw HTML code starting with <!DOCTYPE html>. No markdown, no code fences, no explanation.`
          },
          { role: 'user', content: prompt }
        ],
      }),
    })

    if (!response.ok) {
      const errText = await response.text()
      console.error('AI gateway error:', response.status, errText)
      return new Response(JSON.stringify({ error: 'AI generation failed' }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const data = await response.json()
    const content = data.choices?.[0]?.message?.content ?? ''

    // Deduct credit
    await supabaseClient.rpc('deduct_credit', { user_id: userId })

    return new Response(JSON.stringify({ content }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
