// Simple Resend test email function
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    if (!RESEND_API_KEY) {
      console.error("❌ RESEND_API_KEY is not configured");
      return new Response(
        JSON.stringify({ success: false, error: "RESEND_API_KEY not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    let to = "nazik8856@gmail.com";
    try {
      const body = await req.json();
      if (body?.to && typeof body.to === "string") to = body.to;
    } catch (_) {
      // no body, use default
    }

    const from = "onboarding@resend.dev";
    console.log(`📧 Sending test email to ${to} from ${from}`);

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from,
        to: [to],
        subject: "Test Email from NazAI",
        html: "<h1>Test Email</h1><p>This is a test email from NazAI. If you see this, sending works.</p>",
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      console.error("❌ Resend API error:", JSON.stringify(data));
      return new Response(
        JSON.stringify({ success: false, status: res.status, error: data }),
        { status: res.status, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    console.log(`✅ Test email sent successfully to ${to}. Message ID: ${data?.id}`);
    return new Response(
      JSON.stringify({ success: true, id: data?.id, to, from }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("❌ send-test-email failed:", err);
    return new Response(
      JSON.stringify({ success: false, error: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
