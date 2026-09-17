-- webhooks.secret is the live HMAC signing key for a customer's outbound
-- webhook deliveries. It was selectable via the generic authenticated RLS
-- policy on this table like any other column, so ControlWebhooks.tsx's own
-- listing query re-fetched the plaintext secret into the browser on every
-- page load, indefinitely -- not just once at creation. Anyone who later
-- gained read access to that page's network responses (a compromised
-- session, a browser extension, an accidental log capture, another team
-- member) could recover the live secret and forge validly-signed
-- deliveries to the customer's own receiving endpoint.
--
-- Creation is moved server-side (see the new webhooks-create edge
-- function, which returns the secret exactly once in its response body,
-- generated and inserted via the service-role client). This migration
-- closes the column off from ordinary client reads entirely -- service_role
-- (this function, and the background sweeps in _shared/webhooks.ts that
-- sign outbound deliveries) is unaffected, since REVOKE never applies to
-- the table owner / service_role.
REVOKE SELECT (secret) ON public.webhooks FROM authenticated, anon;

-- Same reasoning applies to the rotated-out secret: it's still valid and
-- signing real deliveries for as long as previous_secret_expires_at hasn't
-- passed (see webhook-secret-rotation.ts), so it's exactly as sensitive as
-- the current one while that grace window is open. Not currently selected
-- by any client query, but closed off at the column level regardless so a
-- future query can't reintroduce this without an explicit, deliberate
-- GRANT.
REVOKE SELECT (previous_secret) ON public.webhooks FROM authenticated, anon;
