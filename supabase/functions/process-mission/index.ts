import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // Authenticate user
    const authHeader = req.headers.get('Authorization')!
    const token = authHeader.replace('Bearer ', '')
    const { data: { user } } = await supabaseClient.auth.getUser(token)
    if (!user) throw new Error('Not authenticated')

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

    // Process directive with Gemini
    const { directive } = await req.json()
    const apiKey = Deno.env.get('GEMINI_API_KEY')

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [{
              text: `You are a senior problem-solving AI. Analyze the following problem and return a JSON object with exactly these keys:
- "solution": A clear, actionable solution (2-3 sentences).
- "explanation": The reasoning behind it (2-3 sentences).
- "actions": An array of 3-5 short action steps (each under 5 words).

Return ONLY valid JSON. No markdown, no code fences.

Problem: ${directive}`
            }]
          }]
        }),
      }
    )

    const data = await response.json()
    const aiText = data.candidates?.[0]?.content?.parts?.[0]?.text

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
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
