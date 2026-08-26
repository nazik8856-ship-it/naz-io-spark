# @nazai/control-api-client

A small, hand-written TypeScript client for [NazAI's Control API](../../src/pages/ControlApiDocs.tsx) --
submit one of your platform's proposed actions and get back a verdict from
NazAI's decision-gating engine.

## Install

This package isn't published to a registry yet -- copy the `src/` directory
into your project, or build it locally and install the tarball:

```bash
cd sdk/control-api-client
npm install
npm run build
npm pack
```

## Usage

```ts
import { ControlApiClient } from "@nazai/control-api-client";

const client = new ControlApiClient({
  apiKey: process.env.NAZAI_API_KEY!, // nazai_sk_...
  baseUrl: "https://<your-project-ref>.supabase.co/functions/v1",
});

const verdict = await client.check({
  actionType: "send_email",
  provider: "Gmail",
  description: "Reply to a customer refund request.",
  params: { to: "customer@example.com" },
});

if (verdict.verdict === "block") {
  console.log("Blocked:", verdict.reason);
}
```

### Full mode (LLM-scored assessment)

```ts
const verdict = await client.check({
  actionType: "post_public_content",
  description: "Publish a blog post about the new pricing.",
  mode: "full",
});
console.log(verdict.confidenceScore, verdict.modification);
```

### Batch requests

Check up to 50 actions in one call:

```ts
const { results } = await client.checkBatch([
  { actionType: "send_email", description: "Reply to a refund request." },
  { actionType: "post_public_content", description: "Post the weekly update." },
]);
for (const r of results) console.log(r.index, r.verdict);
```

### Errors

A non-2xx response (invalid key, rate limited, bad request) throws a
`ControlApiError` with `status` and `body` fields:

```ts
import { ControlApiError } from "@nazai/control-api-client";

try {
  await client.check({ actionType: "x", description: "y" });
} catch (e) {
  if (e instanceof ControlApiError && e.status === 429) {
    console.log("Rate limited, retry shortly.");
  }
}
```
