// Resend Webhook Endpoint
// Public POST endpoint that receives webhook events from Resend.
// Configure this URL in Resend → Webhooks.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, svix-id, svix-timestamp, svix-signature",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (request.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  try {
    const event = await request.json();

    console.log("Received webhook event from Resend:", JSON.stringify(event));

    // Handle different event types
    if (event?.type === "email.received") {
      console.log("Email received event:", JSON.stringify(event));
      return new Response(
        JSON.stringify({ success: true, event }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Log common Resend delivery events for visibility
    if (typeof event?.type === "string") {
      console.log(`Resend event type: ${event.type}`);
    }

    // Default response for other events
    return new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("Webhook error:", error);
    return new Response(
      JSON.stringify({ error: "Invalid webhook payload" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
