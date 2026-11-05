# Protected data in transit

General data security, task 2. Builds on secrets handling (vault, log scrubbing), transport encryption (HTTPS only for every
customer-supplied address, `url-safety.ts`), safe input and output handling (size caps, the untrusted-data fence, no redirects for
signed or checked requests) and the data classes of task 1 (`docs/data-classification.md`).

Nothing here warns and carries on: a request that would carry a credential to the wrong place is not sent, and content leaves with
credentials removed.

## 1. The request guard (every edge function)

`supabase/functions/_shared/outbound-guard.ts` patches `fetch` for the whole function. Every edge function imports it right after
the log scrubber (`import "../_shared/outbound-guard.ts"`).

- **What it protects:** NazAI's own credentials: every environment value whose name says key, secret, token, password, DSN or
  database URL (and is at least 16 characters). The public anon key is not a secret.
- **Where each may go:** only the service it belongs to: `SLACK_*` to slack.com, `GOOGLE_*` to googleapis.com and google.com,
  `NOTION_*` to notion.com, `CANVA_*` to canva.com, `FIGMA_*` to figma.com, `SHOPIFY_*` to myshopify.com and shopify.com, `OPENAI_*`
  to openai.com, `LOVABLE_*` to lovable.dev, `OPENROUTER_*` to openrouter.ai, `ANTHROPIC_*` to anthropic.com, `RESEND_API_KEY` to
  resend.com, `SENTRY_*` to sentry.io (`SECRET_HOSTS`). Every other credential (the service key, `DATA_KEY`, `PROJECTS_KEY`,
  signing secrets, the database URL) goes nowhere but NazAI's own Supabase project.
- **What it looks at:** the address (also URL-encoded), every header and a text body (string, form, bytes, or a `Request`'s body).
- **What happens:** a request that would carry a credential anywhere else is refused before it is sent: `fetch` throws
  `OutboundBlocked`, and the log line names the credential and the host, never the value.

## 2. Content masking (where an account's content leaves NazAI)

`maskOutbound()` / `maskOutboundText()` / `maskedJson()` replace, in every string of what is sent:

- anything shaped like a provider credential: the formats of the built-in "API key or secret" rule (OpenAI, Anthropic, Stripe,
  GitHub, AWS, Slack, Google, Notion, Shopify, Resend keys, private key blocks), except plain JWTs, because NazAI's own expiring file
  links carry one and are meant to be shared;
- every NazAI credential value (as above);
- the tool's own key, where a connected tool is called;

with `[REDACTED:secrets]`. Ordinary text that only mentions a password or a code is left alone.

| Where content leaves | Masked in |
|---|---|
| Outer Control: a connected tool's request (the body sent, and the copy stored with the step) | `outer-control-session.ts` (`outBody`, with the tool's key) |
| Outer Control: an MCP server's tool call | `outer-control-session.ts` (`maskOutboundText`, with the tool's key) |
| An agent's tool call (documents, sheets, calendar, email, any connected service), before the control gate judges it | `agent-runtime` (`maskOutbound(validation.data)`) |
| Every provider write (Slack, Notion, Canva, Shopify, Figma, Google) | `provider-writes.ts` (`runProviderWrite`) |
| Model prompts and embeddings | `ai-gateway.ts` (`callAiGateway`, `callEmbeddingGateway`), and the direct model calls in `control-engine`, `generate-site-images`, `swift-service`, `decision-embeddings.ts` |
| Webhook deliveries and Control API callbacks (masked before they are signed) | `webhooks.ts`, `callback-delegation.ts` |

## 3. What comes back

- A connected tool's reply is checked first, as it arrives, so the account's rules (including the built-in secrets rule) still see
  and judge it. What is stored and passed on is the checked reply with any credential removed (`scrubInbound`,
  `outer-control-session.ts`).
- Unchanged from earlier layers: replies are read with a size cap, a redirect is never followed, and only HTTPS addresses that are not
  private networks are called (`url-safety.ts`).

## 4. Logs

No log line prints a request body, a reply, headers or a credential: outbound and inbound calls are logged by host, status, size and
counts only. The log scrubber (`redact-console.ts`) still removes anything secret that gets through.

## Checks

- **Build:** `src/test/data-in-transit.test.ts`:
  - every edge function imports the request guard right after the log scrubber;
  - each place in the table above still masks (the exact lines are checked);
  - every direct call to a model provider anywhere sends a masked body;
  - no log line passes a body, headers or a credential (text in quotes does not count).
- **Unit:** `supabase/functions/_shared/outbound-guard_test.ts`:
  - which environment values count as credentials;
  - which hosts each may go to (look-alike domains do not count);
  - refusal before sending (address, header, body, `Request` body), while ordinary traffic passes unchanged;
  - masking keeps links, ordinary text and short values.
