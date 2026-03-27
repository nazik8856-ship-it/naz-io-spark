import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // 1. Handle Preflight for CORS
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // 2. Identify the User
    const authHeader = req.headers.get('Authorization')!
    const token = authHeader.replace('Bearer ', '')
    const { data: { user } } = await supabaseClient.auth.getUser(token)

    if (!user) throw new Error('Not authenticated')

    // 3. Check Trial Credits
    const { data: profile } = await supabaseClient
      .from('profiles')
      .select('credits')
      .eq('id', user.id)
      .single()

    if (!profile || profile.credits <= 0) {
      return new Response(JSON.stringify({ error: "No free trials left! Invite a friend to get more." }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // 4. Call Google Gemini (The Free Engine)
    const { prompt } = await req.json()
    const apiKey = Deno.env.get('GEMINI_API_KEY')
    
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: Create a professional business and website structure for: ${prompt} }] }]
      }),
    })

    const data = await response.json()
    const aiText = data.candidates[0].content.parts[0].text

    // 5. Subtract 1 Credit from their account
    await supabaseClient
      .from('profiles')
      .update({ credits: profile.credits - 1 })
      .eq('id', user.id)

    return new Response(JSON.stringify({ content: aiText }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})