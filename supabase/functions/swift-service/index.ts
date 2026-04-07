import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const { prompt, targetModel } = await req.json()
    const openRouterApiKey = Deno.env.get('OPENROUTER_API_KEY')

    if (!openRouterApiKey) {
      throw new Error('OPENROUTER_API_KEY is not set')
    }

    // Default to a fast model if targetModel is missing
    const model = targetModel || "google/gemini-2.0-flash-001"

    console.log(`Requesting model: ${model}`)

    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${openRouterApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        "model": model,
        "messages": [
          { "role": "user", "content": prompt }
        ],
      })
    })

    const data = await response.json()
    const aiResponse = data.choices[0].message.content

    return new Response(JSON.stringify({ text: aiResponse }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
