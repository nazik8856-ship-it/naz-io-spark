// Brand-accurate SVG logos for AI engines used in NazAI
// Each component accepts { size, className, style } similar to lucide-react icons
import React from "react";

type LogoProps = {
  size?: number;
  className?: string;
  style?: React.CSSProperties;
  color?: string; // ignored — brand colors are baked in
};

const wrap = (size: number, className?: string, style?: React.CSSProperties, children?: React.ReactNode) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    style={style}
    aria-hidden="true"
  >
    {children}
  </svg>
);

// ── GEMINI (Google) — four-pointed star, blue→cyan gradient ────────────────────
export const GeminiLogo: React.FC<LogoProps> = ({ size = 16, className, style }) =>
  wrap(size, className, style, (
    <>
      <defs>
        <linearGradient id="gemini-grad" x1="0" y1="0" x2="24" y2="24" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#4285F4" />
          <stop offset="50%" stopColor="#9B72F5" />
          <stop offset="100%" stopColor="#1FA7FF" />
        </linearGradient>
      </defs>
      <path
        d="M12 1.5c.4 4.5 2.4 8.1 6.7 9.6.9.3.9 1.5 0 1.8-4.3 1.5-6.3 5.1-6.7 9.6-.1.7-1.1.7-1.2 0-.4-4.5-2.4-8.1-6.7-9.6-.9-.3-.9-1.5 0-1.8C8.4 9.6 10.4 6 10.8 1.5c.1-.7 1.1-.7 1.2 0Z"
        fill="url(#gemini-grad)"
      />
    </>
  ));

// ── CLAUDE (Anthropic) — terracotta starburst ──────────────────────────────────
export const ClaudeLogo: React.FC<LogoProps> = ({ size = 16, className, style }) =>
  wrap(size, className, style, (
    <>
      <circle cx="12" cy="12" r="11" fill="#D97757" />
      <path
        d="M8.4 8.2 6 16h1.6l.5-1.7h2.4l.5 1.7h1.6l-2.4-7.8H8.4Zm.05 4.7.85-2.85.85 2.85h-1.7Zm6.4-4.7v7.8h1.5V8.2h-1.5Z"
        fill="#FFFFFF"
      />
    </>
  ));

// ── GPT (OpenAI) — knot mark ───────────────────────────────────────────────────
export const OpenAILogo: React.FC<LogoProps> = ({ size = 16, className, style }) =>
  wrap(size, className, style, (
    <path
      d="M22.28 9.81a5.99 5.99 0 0 0-.51-4.91 6.05 6.05 0 0 0-6.51-2.9A5.98 5.98 0 0 0 10.74.5a6.05 6.05 0 0 0-5.78 4.4 5.98 5.98 0 0 0-3.99 2.9 6.05 6.05 0 0 0 .74 7.09 5.98 5.98 0 0 0 .51 4.91 6.05 6.05 0 0 0 6.51 2.9 5.98 5.98 0 0 0 4.51 2.01 6.05 6.05 0 0 0 5.78-4.41 5.98 5.98 0 0 0 3.99-2.9 6.05 6.05 0 0 0-.73-7.09Zm-9.06 12.67a4.5 4.5 0 0 1-2.88-1.04l.14-.08 4.78-2.76a.78.78 0 0 0 .39-.68v-6.74l2.02 1.17a.07.07 0 0 1 .04.05v5.58a4.5 4.5 0 0 1-4.49 4.5Zm-9.66-4.13a4.49 4.49 0 0 1-.54-3.02l.14.08 4.78 2.76a.78.78 0 0 0 .78 0l5.84-3.37v2.33a.07.07 0 0 1-.03.06l-4.83 2.79a4.5 4.5 0 0 1-6.14-1.63Zm-1.26-10.4a4.49 4.49 0 0 1 2.34-1.97v5.68c-.01.27.13.53.39.68l5.81 3.35-2.02 1.17a.07.07 0 0 1-.07 0l-4.83-2.79a4.5 4.5 0 0 1-1.62-6.12Zm16.59 3.86-5.84-3.39 2.02-1.16a.07.07 0 0 1 .07 0l4.83 2.78a4.5 4.5 0 0 1-.68 8.11v-5.67a.79.79 0 0 0-.4-.67Zm2.01-3.02-.14-.09L15.99 5.94a.78.78 0 0 0-.79 0L9.36 9.31V6.98a.07.07 0 0 1 .03-.06l4.83-2.78a4.5 4.5 0 0 1 6.68 4.66Zm-12.64 4.15-2.02-1.17a.07.07 0 0 1-.04-.05V6.14a4.5 4.5 0 0 1 7.38-3.45l-.14.08L8.36 5.53a.78.78 0 0 0-.39.68l-.01 6.73Zm1.1-2.36 2.6-1.5 2.6 1.5v3l-2.6 1.5-2.6-1.5v-3Z"
      fill="currentColor"
    />
  ));

// ── GROK (xAI) — slash mark ────────────────────────────────────────────────────
export const GrokLogo: React.FC<LogoProps> = ({ size = 16, className, style }) =>
  wrap(size, className, style, (
    <>
      <rect x="2" y="2" width="20" height="20" rx="4" fill="#000000" />
      <path
        d="M7 7l6 6m1-6l-7 10m10-10-3 4 3 6"
        stroke="#FFFFFF"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </>
  ));

// ── ELEVENLABS — stylized "11" mark ────────────────────────────────────────────
export const ElevenLabsLogo: React.FC<LogoProps> = ({ size = 16, className, style }) =>
  wrap(size, className, style, (
    <>
      <rect x="2" y="2" width="20" height="20" rx="3" fill="#000000" />
      <rect x="8" y="6.5" width="2.4" height="11" rx="0.4" fill="#FFFFFF" />
      <rect x="13.6" y="6.5" width="2.4" height="11" rx="0.4" fill="#FFFFFF" />
    </>
  ));

// ── VEO (Google) — film/cinema mark with Google gradient ───────────────────────
export const VeoLogo: React.FC<LogoProps> = ({ size = 16, className, style }) =>
  wrap(size, className, style, (
    <>
      <defs>
        <linearGradient id="veo-grad" x1="0" y1="0" x2="24" y2="24" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#4285F4" />
          <stop offset="50%" stopColor="#EA4335" />
          <stop offset="100%" stopColor="#FBBC04" />
        </linearGradient>
      </defs>
      <rect x="2.5" y="5" width="14.5" height="14" rx="3" fill="url(#veo-grad)" />
      <path d="M17 9.5 22 7v10l-5-2.5v-5Z" fill="url(#veo-grad)" />
    </>
  ));

// ── NANO BANANA (Gemini Image) — banana glyph in Gemini gradient ───────────────
export const NanoBananaLogo: React.FC<LogoProps> = ({ size = 16, className, style }) =>
  wrap(size, className, style, (
    <>
      <defs>
        <linearGradient id="nano-grad" x1="0" y1="0" x2="24" y2="24" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#FFD23F" />
          <stop offset="100%" stopColor="#FF8A00" />
        </linearGradient>
      </defs>
      <path
        d="M4 5c0 8 5 14 13 15 1.2.1 2-.5 1.6-1.6C16 11 11 6 4.4 3.5 3.4 3.1 2.5 4 4 5Z"
        fill="url(#nano-grad)"
        stroke="#7A4A00"
        strokeWidth="0.6"
      />
      <circle cx="3.6" cy="3.4" r="0.7" fill="#7A4A00" />
    </>
  ));

// Helper map for id → Logo component
export const ENGINE_LOGOS: Record<string, React.FC<LogoProps>> = {
  "google/gemini-3.1-pro": GeminiLogo,
  "anthropic/claude-4.6-sonnet": ClaudeLogo,
  "openai/gpt-5.4": OpenAILogo,
  "google/gemini-3-flash-image": NanoBananaLogo,
  "google/veo-3": VeoLogo,
  "elevenlabs/lyria": ElevenLabsLogo,
  "x-ai/grok-4.20": GrokLogo,
};
