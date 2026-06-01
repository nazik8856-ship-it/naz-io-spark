## Goal

When a user clicks "Start Free Mission" (or any auth-gated CTA), the registration window should appear only once — for users who are not signed in. Once they've signed in or signed up, subsequent clicks must skip the modal and go straight to `/dashboard`.

## Changes

### 1. `src/pages/Workflower.tsx`
- `launchMission()` (line 142): when `user` is present, navigate to `/dashboard` instead of `/workspace`.
- `handleAuthSuccess()` (line 153): navigate to `/dashboard` instead of `/workspace` so first-time signup also lands on the dashboard.
- "Sign In" button (line 263): if `user` is already authenticated, navigate to `/dashboard` instead of opening `AuthModal`. (For unauthenticated users, behavior is unchanged — modal opens once.)
- Gated nav buttons (line 232–238): no change needed; they already check `user` before opening the modal.
- Any other in-page CTAs that currently call `setAuthModalOpen(true)` unconditionally get wrapped with the same `user ? navigate("/dashboard") : setAuthModalOpen(true)` guard.

### 2. `src/components/mission/ActionTerminal.tsx`
- Lines 214 and 444: replace `setShowAuthModal(true)` calls with `isAuthorized ? startWorkflow() : setShowAuthModal(true)` (line 444 already does this; line 214 needs the same guard) so an authenticated user never sees the modal again.
- `onSuccess={startWorkflow}` is already correct — after first successful auth, the workflow continues without re-prompting.

### 3. No backend / no schema changes
Auth persistence is already handled by `AuthProvider` + Supabase session — once signed in, `user` stays populated across reloads, so the modal naturally won't reappear.

## Result
- First visit, not signed in → "Start Free Mission" opens `AuthModal` once → on success, redirect to `/dashboard`.
- Any subsequent visit while session is valid → "Start Free Mission" / "Sign In" / gated CTAs go straight to `/dashboard`, no modal.
