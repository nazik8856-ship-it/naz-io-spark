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

## 5. Where a request may go (security task 2)

`_shared/egress.ts`, enforced by the request guard above for every `fetch` in every function. A request goes to exactly one of:

1. NazAI's own Supabase project (`SUPABASE_URL`);
2. a service on `NAZAI_EGRESS_HOSTS` or a subdomain of one (each listed with its reason: model providers, email, error reports, the
   connectors' APIs and OAuth, public account search);
3. a customer's own address (a connected tool, a webhook, a callback, a page to import, an image a model returned), and only after it
   passed `validateOutboundUrl` (https, every DNS answer public, no credential in it). That check approves the origin for five
   minutes. `customerFetch` (`url-safety.ts`) does both and follows redirects by hand, checking every hop.

Anything else is refused before it is sent (`OutboundBlocked`, recorded as `outbound_blocked` evidence where it meets an account).
Plain `http` is refused for every destination (only NazAI's own project may be http, and only when `SUPABASE_URL` itself is, which
is local development). A customer request never follows a redirect by itself: the guard sends it with `redirect: "manual"`.

Limits: the check runs when the address is approved, so a customer's DNS could change in the five minutes after it (the request is
still https to the same name). A redirect from a listed service is followed (the service is trusted). Adding a service to the list is
a code change, reviewed like any other; the build fails when a function names a host that is neither listed nor a reviewed link.

## 6. Responses are never cached

Every response a function sends carries `Cache-Control: no-store` (a weaker `no-cache` is replaced): the request guard wraps
`Deno.serve`, and every function serves with `Deno.serve` (the 19 that used the old `std` server were moved). No browser, proxy or
CDN keeps a copy of an account's content.

## 7. What the browser keeps

`src/lib/browser-storage.ts` lists every `localStorage` and `sessionStorage` key the website writes and what it holds. Rules:

- no account content and no credential in `localStorage`; content that has to cross a page change lives in memory
  (`preview-cache.ts`: the website preview's first frame, read from the parent or opener window of the same site) or, for one tab,
  in `sessionStorage` (approved replies, the directive handed across the sign-in redirect);
- API key values typed into the dashboard checklist are kept only while the page is open; only their names are saved. To let NazAI
  use a key, the service is connected under Connections, where the key is kept in the vault;
- when the website starts, what older versions left (cached site content and briefs, approved replies, saved key values) is removed;
  on sign-out the tab's content and account choice are removed.

Limit: the sign-in session itself (`sb-…` in `localStorage`) is kept by supabase-js so a reload stays signed in. The access token in
it expires within an hour and the refresh token rotates on use; the content security policy limits which scripts can run.

## 8. Web addresses in logs, error reports and evidence

Every web address in a log line, an error report (server and website, Sentry and PostHog) or a security evidence subject keeps its
host and path; each query or fragment value is replaced by `…` (the parameter names stay). Query strings carry search terms, email
addresses and tokens. `maskUrlQueries` in `redact-secrets.ts`.

## Checks

- **Build:** `src/test/data-in-transit.test.ts`:
  - every edge function imports the request guard right after the log scrubber;
  - each place in the table above still masks (the exact lines are checked);
  - every direct call to a model provider anywhere sends a masked body;
  - no log line passes a body, headers or a credential (text in quotes does not count);
  - every host a function names is on the egress allowlist or a reviewed link; the guard enforces the list, refuses plain http and
    sends customer requests without following redirects;
  - every function serves with `Deno.serve` (so every response gets `no-store`), and nothing asks for caching.
- **Build:** `src/test/browser-storage.test.ts`: every browser-storage key the website writes is registered; nothing holding content
  is in `localStorage`; old copies are removed at start and on sign-out.
- **Unit:** `supabase/functions/_shared/outbound-guard_test.ts`:
  - which environment values count as credentials;
  - which hosts each may go to (look-alike domains do not count);
  - refusal before sending (address, header, body, `Request` body), while ordinary traffic passes unchanged;
  - masking keeps links, ordinary text and short values;
  - the egress rules (listed services, checked customer origins and their expiry, no http, no credentials in the address), the guard
    refusing before sending, `no-store` on every `Deno.serve` form, and query masking.
