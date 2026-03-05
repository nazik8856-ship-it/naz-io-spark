import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SYSTEM_PROMPT = `You are a world-class web designer and developer. The user will give you a description of a website they want. You must generate a COMPLETE, single-file HTML page with inline CSS and minimal inline JS.

Rules:
- Return ONLY the raw HTML code, no markdown fences, no explanations
- The HTML must be a complete document with <!DOCTYPE html>, <html>, <head>, <body>
- Use modern CSS (flexbox, grid, gradients, animations, custom properties)
- Make it visually stunning with a bold, modern design
- Use Google Fonts via CDN link in <head>
- Include responsive design with media queries
- Add subtle CSS animations and transitions
- Use a cohesive color palette
- Add placeholder images using https://placehold.co/WIDTHxHEIGHT/HEX_BG/HEX_TEXT
- Include realistic placeholder text content
- Make it look like a real, production-ready website
- The page must be fully self-contained (no external JS frameworks)
- Add smooth scroll behavior
- Include a navigation bar, hero section, and footer at minimum`;

const EDIT_SYSTEM_PROMPT = `You are a world-class web designer and developer. The user has an existing website and wants you to edit or improve it. You will receive the current HTML and the user's edit request.

Rules:
- Return ONLY the complete updated HTML code, no markdown fences, no explanations
- Keep all existing structure and styling unless the user asks to change it
- Apply the requested changes while maintaining the overall design coherence
- The output must be a complete, self-contained HTML document
- Preserve any existing animations, responsive design, and fonts`;

function buildMessages(prompt: string, currentHTML?: string, chatHistory?: Array<{role: string, content: string}>) {
  if (currentHTML && chatHistory && chatHistory.length > 0) {
    // Edit mode: include current HTML context and chat history
    return [
      { role: "system", content: EDIT_SYSTEM_PROMPT },
      { role: "user", content: `Here is the current website HTML:\n\n${currentHTML}` },
      { role: "assistant", content: "I have the current website. What changes would you like me to make?" },
      ...chatHistory.map((m: any) => ({ role: m.role, content: m.content })),
    ];
  }
  // Initial generation
  return [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: prompt },
  ];
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { prompt, currentHTML, chatHistory } = await req.json();

    if (!prompt || typeof prompt !== "string" || prompt.trim().length === 0) {
      return new Response(
        JSON.stringify({ error: "A prompt is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    const response = await fetch(
      "https://ai.gateway.lovable.dev/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-3-flash-preview",
          messages: buildMessages(prompt, currentHTML, chatHistory),
          stream: true,
        }),
      }
    );

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limit exceeded. Please try again in a moment." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: "Usage limit reached. Please add credits." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const text = await response.text();
      console.error("AI gateway error:", response.status, text);
      return new Response(
        JSON.stringify({ error: "Failed to generate website" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(response.body, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (e) {
    console.error("generate-website error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
