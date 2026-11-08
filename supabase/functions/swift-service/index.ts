import "../_shared/redact-console.ts"; // first: secrets never reach the function logs
import { maskedJson } from "../_shared/outbound-guard.ts"; // second: no request carries a NazAI credential to a host it does not belong to
import { readJson } from "../_shared/input.ts"
import { cleanText } from "../_shared/clean-text.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { requireCaller } from "../_shared/caller.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    // Authenticate user
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing Authorization header' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    const authed = await requireCaller(req, (h) => createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_ANON_KEY") ?? "", { global: { headers: { Authorization: h } } }));
    if (!authed.ok) {
      return new Response(JSON.stringify({ error: 'Not authenticated' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const inputRead = await readJson(req, { headers: corsHeaders, maxBytes: 128 * 1024 })
    if (!inputRead.ok) return inputRead.response
    const prompt = cleanText(inputRead.value.prompt, { max: 20000 })
    // a model name is a short token (letters, digits and . _ / : -), never free text
    const targetModel = typeof inputRead.value.targetModel === 'string' && /^[A-Za-z0-9._/:-]{1,80}$/.test(inputRead.value.targetModel.trim()) ? inputRead.value.targetModel.trim() : undefined
    if (!prompt) {
      return new Response(JSON.stringify({ error: 'prompt is required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }
    const openRouterApiKey = Deno.env.get('OPENROUTER_API_KEY')

    if (!openRouterApiKey) {
      throw new Error('OPENROUTER_API_KEY is not set')
    }

    const model = targetModel || "google/gemini-2.0-flash-001"

    console.log(`Requesting model: ${model}`)

    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${openRouterApiKey}`,
        "Content-Type": "application/json",
      },
      body: maskedJson({
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
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
