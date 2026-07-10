## Goal

Apply the same `createPortal` + `fixed` positioning fix to the sliders/tuner panel that was already applied to the "+" panel, so both popups render visibly above their buttons.Also from the previous prompt we've discussed about there's a slider button.Implement those features as well so it's done all-in-one

## Current state

In `src/components/generator/PromptExtras.tsx`:

- The "+" panel already uses `createPortal` with `fixed` positioning, solid `bg-zinc-950`, `zIndex: 10000`, and `plusPanelRef` / `plusPos` state.
- The tuner panel still uses `absolute bottom-full ... bg-zinc-950/95 backdrop-blur-xl z-50` inside a `relative` wrapper — this is what makes it wash out against the blurred prompt bar.
- There's also leftover breakage from the previous edit: a stray `)}` / extra closing `</div>` after the "+" portal block, and the tuner wrapper still references a non-existent `tunerRef` (`<div className="relative" ref={tunerRef}>`). `tunerPanelRef` and `tunerPos` state are declared but unused. This currently prevents the file from compiling cleanly.

## Changes (single file: `src/components/generator/PromptExtras.tsx`)

1. Remove the stale `<div className="relative" ref={tunerRef}>` wrapper around the sliders button (the button already has `tunerBtnRef`; no relative wrapper needed once we portal).
2. Fix the stray closing tag left over from the "+" portal conversion so JSX balances.
3. Convert the tuner panel to the same pattern as the "+" panel:
  - Render via `createPortal(..., document.body)` only when `tunerOpen && tunerPos`.
  - Attach `tunerPanelRef` to the panel root.
  - Use `style={{ position: "fixed", left: tunerPos.left, bottom: tunerPos.bottom, zIndex: 10000 }}`.
  - Replace `bg-zinc-950/95 backdrop-blur-xl` with solid `bg-zinc-950`; drop `absolute bottom-full left-0 mb-2 z-50`.
  - Keep width (`w-80`), border, padding, shadow, and all inner content (tone chips, integrations list, CSV upload) unchanged.
4. Leave `computePos`, the `useLayoutEffect` that sets `tunerPos`, and the outside-click handler as-is — they already cover the tuner.

No behavior/logic changes beyond rendering location; attachments, tone state, integration fetch, and `buildContextPrompt` stay identical.

## Verification

- Confirm file compiles (typecheck runs automatically).
- Visually: open generator prompt bar, click sliders — panel should appear as a solid dark popup directly above the button, same as "+".

Also from the previous prompt we've discussed about there's a slider button.Implement those features as well so it's done all-in-one