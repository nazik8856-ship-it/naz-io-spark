# Upgrade website generation to unique, polished sites

Goal: every generated site gets its own palette, type pair, layout personality, animations, imagery, and section extras — driven by the prompt. If the user names a style, follow it strictly. Otherwise invent something fitting and avoid AI-design clichés.

## 1. `compile-website-manifest` — smarter design brief

Rewrite the system prompt so the model acts as a senior brand+web designer, not a JSON filler.

- **User-directive lock.** New instruction block: "If the brief specifies colors, fonts, vibe, imagery, features, or references — obey them exactly. Only invent when the user is silent on that dimension."
- **Anti-cliché rules.** Explicit "Do NOT default to: cream + serif + terracotta, all-black + single neon accent, generic centered hero with 3 feature icons, Inter for everything, purple→pink gradient. Pick something specific to this business." Model must justify palette/font/layout choice in an internal `design_rationale` string on `theme`.
- **Per-site identity fields.** Expand `theme` jsonb (backward compatible — same column, richer shape):
  - `palette`: keep `bg/surface/text/accent/accentSecondary`, add optional `muted`, `border`.
  - `font`: `heading`, `body`, plus optional `mono` and `display`.
  - `vibe`: short phrase (kept).
  - `layout`: `"centered" | "asymmetric" | "editorial" | "split" | "grid-heavy" | "magazine" | "minimal-luxury" | "brutalist" | "playful"` — controls hero + section rhythm.
  - `motion`: `"subtle" | "expressive" | "kinetic" | "none"`.
  - `design_rationale`: 1-2 sentences of why this fits the brief (used by renderer to stay consistent on edits).
- **Section variety.** Model chooses per-section `variant` strings (e.g. `hero.variant = "split-image" | "full-bleed" | "editorial-lede" | "asymmetric-mark"`), plus richer content shapes:
  - hero: add `eyebrow`, `stats?`, `media_style` (photo | illustration | gradient | pattern).
  - about: add optional `image_prompt`, `pull_quote`.
  - services: add `layout_hint` (cards | list | numbered | zigzag).
  - gallery: add `layout_hint` (masonry | grid | strip | showcase).
  - New optional section types: `stats`, `process`, `cta`, `logos`, `feature-split`.
- **Functional extras on request.** If the brief mentions calculator, booking, quote form, ROI, etc., emit a `custom` section: `{ type: "custom", content: { kind: "calculator" | "booking" | "quote" | "newsletter" | ..., fields, formula? } }`. Renderer wires the interactive version.
- **Image prompts everywhere.** Every visual section must include an `image_prompt` (or `items[].image_prompt`) that is specific — subject, mood, lighting, palette hint.
- **Normalization.** Extend `normalize()` to accept the new fields, keep defaults when missing, and never overwrite user-specified values.

## 2. Renderer (`src/pages/WebsitePreview.tsx`) — identity-aware output

- **Read the new theme fields.** Apply `layout`, `motion`, extra palette tokens. Load fonts for heading/body/mono if present.
- **Per-layout hero + section rhythm.** Add hero variants (split-image, full-bleed, editorial-lede, asymmetric-mark, minimal-luxury) selected by `layout` + `hero.variant`. Vary section padding, container width, alignment, and dividers so sites don't share silhouette.
- **Real imagery.** For sections with `image_prompt`, render an `<img>` sourced from a deterministic image service (Unsplash Source or picsum keyed by seeded prompt hash) so previews show real photos, not gradient placeholders. Keep gradient fallback if load fails.
- **Deliberate animations.** Small, motion-tier aware:
  - Page load: staggered fade+rise on hero children (150–400 ms).
  - Scroll reveal: IntersectionObserver adds `data-in` on sections → CSS fade/translate. Disabled when `motion: "none"` or `prefers-reduced-motion`.
  - Hover: cards lift + accent underline, buttons get accent glow, gallery items zoom+caption slide.
  - `motion: "kinetic"` adds a subtle parallax on hero media only.
  All done with plain CSS + one small observer hook — no new deps.
- **Section variants render distinctly.** Services `numbered` vs `cards` vs `zigzag`; gallery `masonry` vs `strip`; pricing gets a highlighted middle tier with scale.
- **Functional extras.** Implement renderers for the `custom` kinds:
  - `calculator`: inputs → live output using `formula` (safe evaluator over declared variables).
  - `booking`/`quote`/`newsletter`: real forms with validation, submit to console + toast (no backend wiring in this pass).
- **Style isolation.** Inject a scoped `<style>` block with CSS variables from the palette so the whole page uses tokens, not hard-coded colors. Fixes contrast automatically for light palettes.
- **SEO.** Set `document.title` + meta description from the active page.

## 3. Persistence

- No schema change needed — `theme` is already jsonb. New fields ride inside it.
- Ensure `compile-website-manifest` writes the full expanded theme so later edits stay on-identity.

## 4. Out of scope

- No new edge function.
- No changes to auth, credits, or routing.
- No AI image generation call in this pass (kept fast + free via Unsplash/picsum); can be upgraded later.

## Files touched

- `supabase/functions/compile-website-manifest/index.ts` — expanded schema doc, stricter anti-cliché system prompt, richer `normalize()`.
- `src/pages/WebsitePreview.tsx` — theme-aware layout engine, hero/section variants, scroll-reveal + hover CSS, real images, custom section renderers, SEO tags.

## Technical notes

- Anti-cliché list is enforced in the system prompt, not post-processed — cheaper and more reliable with Gemini Flash.
- Scroll reveals use one shared `IntersectionObserver`, ~30 lines, no library.
- Image URLs: `https://source.unsplash.com/1600x900/?${encodeURIComponent(prompt keywords)}` with a stable hash suffix so the same section keeps the same image across reloads.
- Safe calculator: parse `formula` as `a*x + b*y` style expression via a whitelisted tokenizer; reject anything else and fall back to sum.
