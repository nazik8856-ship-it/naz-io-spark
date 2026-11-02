// Safe input & output handling, front 3: text that leaves for another service is escaped for THAT service.
//   - email headers (To, From, Subject, file names): a line break in a value would end the header and start a new one, so a recipient or
//     subject taken from a model or a form could add a Bcc: line and send copies anywhere. Line breaks and control characters go.
//   - Slack: a message can ping a whole workspace with <!channel>, <!here>, <!everyone> or a user group; those are turned into plain words.
// Everything is cut to a sensible size first.

import { cleanText } from "./clean-text.ts";

/** One header value: a single line, no control characters, at most `max` characters. */
export function headerValue(v: unknown, max = 998): string {
  return cleanText(v, { multiline: false, max });
}

/** A recipient list: each address is cleaned; anything that is not shaped like an address is dropped; at most 50. */
export function recipientList(v: unknown): string {
  const parts = headerValue(v, 4000).split(/[,;]/).map((p) => p.trim()).filter(Boolean);
  const ok = parts.filter((p) => /^(?:[^<>"\s]+@[^<>"\s]+\.[^<>"\s]+|[^<>"@]{0,80}<[^<>"\s]+@[^<>"\s]+\.[^<>"\s]+>)$/.test(p));
  return ok.slice(0, 50).join(", ");
}

/** A file name inside a MIME header: no quotes, backslashes, line breaks or path parts. */
export function attachmentName(v: unknown): string {
  const n = headerValue(String(v ?? "").split(/[\\/]/).pop() ?? "", 120).replace(/["\\]/g, "_");
  return n || "attachment";
}

/** Slack text with workspace-wide mentions turned into plain words, cleaned and cut. */
export function slackText(v: unknown, max = 12000): string {
  return cleanText(v, { max, trim: false }).replace(/<!(channel|here|everyone|subteam\^[A-Z0-9]+)(?:\|([^>]*))?>/gi, (_m, what: string, label?: string) => `@${label?.replace(/^@/, "") || what.split("^")[0]}`);
}
