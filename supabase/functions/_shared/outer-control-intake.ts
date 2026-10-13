// Intake for Outer Control: turns whatever an external AI tool hands us into
// the plain text that gets judged. Pure, so every accepted shape and every
// refusal is unit-tested.
//
// External tools send the provider's raw response, not a bare string, so the
// caller used to have to unwrap `choices[0].message.content` (OpenAI) or
// `content[0].text` (Anthropic) itself before calling. Accepted here:
//   - a plain string
//   - a list of content blocks  [{type:"text", text}]
//   - OpenAI chat completions   {choices:[{message:{content}}]}
//   - OpenAI Responses API      {output_text} / {output:[{content:[{text}]}]}
//   - Anthropic Messages        {content:[{type:"text", text}]}
//   - Google Gemini             {candidates:[{content:{parts:[{text}]}}]}
// Anything else is refused with `unsupported_shape` rather than guessed at:
// judging the JSON envelope instead of the model's words would be a verdict
// on the wrong thing.

/** Max characters judged per call. Long answers are scanned in full up to this cap. */
export const MAX_CONTENT_CHARS = 50_000;
export const MAX_EXTERNAL_ID_CHARS = 200;

export type IntakeFormat = "text" | "blocks" | "openai_chat" | "openai_responses" | "anthropic" | "gemini";

export type IntakeResult =
  | { ok: true; text: string; format: IntakeFormat }
  | { ok: false; code: "content_required" | "unsupported_shape" | "content_too_long"; message: string };

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => !!v && typeof v === "object" && !Array.isArray(v);

/** Text of a list of content blocks; only text-bearing blocks count (tool calls, images are skipped). */
function blocksText(blocks: unknown): string | null {
  if (!Array.isArray(blocks)) return null;
  const parts: string[] = [];
  for (const b of blocks) {
    if (typeof b === "string") parts.push(b);
    else if (isObj(b) && typeof b.text === "string" && (b.type === undefined || b.type === "text" || b.type === "output_text")) parts.push(b.text);
  }
  return parts.join("\n\n");
}

function join(parts: (string | null)[]): string {
  return parts.filter((p): p is string => typeof p === "string" && p.length > 0).join("\n\n");
}

export function extractExternalText(raw: unknown): IntakeResult {
  let text: string | null = null;
  let format: IntakeFormat = "text";

  if (typeof raw === "string") {
    text = raw;
  } else if (Array.isArray(raw)) {
    text = blocksText(raw);
    format = "blocks";
  } else if (isObj(raw)) {
    if (Array.isArray(raw.choices)) {
      format = "openai_chat";
      text = join(raw.choices.map((c) => {
        if (!isObj(c)) return null;
        if (isObj(c.message)) {
          return typeof c.message.content === "string" ? c.message.content : blocksText(c.message.content);
        }
        return typeof c.text === "string" ? c.text : null; // legacy completions
      }));
    } else if (typeof raw.output_text === "string") {
      format = "openai_responses";
      text = raw.output_text;
    } else if (Array.isArray(raw.output)) {
      format = "openai_responses";
      text = join(raw.output.map((o) => (isObj(o) ? blocksText(o.content) : null)));
    } else if (Array.isArray(raw.candidates)) {
      format = "gemini";
      text = join(raw.candidates.map((c) => {
        if (!isObj(c) || !isObj(c.content) || !Array.isArray(c.content.parts)) return null;
        return join(c.content.parts.map((p) => (isObj(p) && typeof p.text === "string" ? p.text : null)));
      }));
    } else if (Array.isArray(raw.content)) {
      format = "anthropic";
      text = blocksText(raw.content);
    }
  }

  if (text === null) {
    return {
      ok: false,
      code: "unsupported_shape",
      message:
        "content must be a string, a list of text blocks, or a response object from OpenAI (choices / output_text / output), " +
        "Anthropic (content blocks) or Gemini (candidates). Send the model's text as a string for any other tool.",
    };
  }
  if (!text.trim()) {
    return { ok: false, code: "content_required", message: "content (the external AI's raw output to evaluate) is required and contained no text." };
  }
  if (text.length > MAX_CONTENT_CHARS) {
    return { ok: false, code: "content_too_long", message: `The response text is ${text.length} characters; the limit is ${MAX_CONTENT_CHARS}.` };
  }
  return { ok: true, text, format };
}

/** external_id: optional; when present a retried call with the same id returns the stored verdict. */
export function parseExternalId(raw: unknown): { ok: true; id: string | null } | { ok: false; message: string } {
  if (raw === undefined || raw === null) return { ok: true, id: null };
  if (typeof raw !== "string" || !raw.trim() || raw.trim().length > MAX_EXTERNAL_ID_CHARS) {
    return { ok: false, message: `external_id must be a non-empty string of at most ${MAX_EXTERNAL_ID_CHARS} characters.` };
  }
  return { ok: true, id: raw.trim() };
}
