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
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

    if (!supabaseUrl || !serviceRoleKey) {
      console.error('Missing env vars:', { hasUrl: !!supabaseUrl, hasKey: !!serviceRoleKey })
      return new Response(
        JSON.stringify({ error: 'Server configuration error: missing credentials' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const supabaseClient = createClient(supabaseUrl, serviceRoleKey)

    // Get request body
    const { prompt, userId, currentHTML, chatHistory } = await req.json()

    if (!userId) {
      return new Response(
        JSON.stringify({ error: 'userId is required in request body' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Check credits
    const { data: profile } = await supabaseClient
      .from('profiles')
      .select('credits')
      .eq('id', userId)
      .single()
    const apiKey = Deno.env.get('GEMINI_API_KEY')

    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: 'Server configuration error: missing AI key' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Call Gemini
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: `Create a professional business website as a single self-contained HTML file with inline CSS and JS for: ${prompt}` }] }],
        }),
      }
    )

    const data = await response.json()

    if (!data.candidates?.[0]?.content?.parts?.[0]?.text) {
      console.error('Gemini response error:', JSON.stringify(data))
      return new Response(
        JSON.stringify({ error: 'AI generation failed. Please try again.' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const aiText = data.candidates[0].content.parts[0].text

    // Deduct 1 credit
    await supabaseClient
      .from('profiles')
      .update({ credits: profile.credits - 1 })
      .eq('id', userId)

    return new Response(
      JSON.stringify({ content: aiText }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('swift-service error:', error)
    return new Response(
      JSON.stringify({ error: error.message || 'An unexpected error occurred' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
