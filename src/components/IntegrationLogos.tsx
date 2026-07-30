// Brand-accurate SVG logos for the integrations NazAI can connect to.
// Each component accepts { size, className, style } similar to lucide-react icons.
import React from "react";

type LogoProps = {
  size?: number;
  className?: string;
  style?: React.CSSProperties;
};

const wrap = (
  size: number,
  viewBox: string,
  className?: string,
  style?: React.CSSProperties,
  children?: React.ReactNode,
) => (
  <svg
    width={size}
    height={size}
    viewBox={viewBox}
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    style={style}
    aria-hidden="true"
  >
    {children}
  </svg>
);

// ── SLACK ──────────────────────────────────────────────────────────────────────
export const SlackLogo: React.FC<LogoProps> = ({ size = 16, className, style }) =>
  wrap(size, "0 0 24 24", className, style, (
    <>
      <path d="M5.1 15.1a2.1 2.1 0 1 1-2.1-2.1h2.1v2.1Zm1.06 0a2.1 2.1 0 0 1 4.2 0v5.26a2.1 2.1 0 1 1-4.2 0V15.1Z" fill="#E01E5A" />
      <path d="M8.26 5.1a2.1 2.1 0 1 1 2.1-2.1v2.1h-2.1Zm0 1.07a2.1 2.1 0 0 1 0 4.2H3a2.1 2.1 0 1 1 0-4.2h5.26Z" fill="#36C5F0" />
      <path d="M18.9 8.26a2.1 2.1 0 1 1 2.1 2.1h-2.1v-2.1Zm-1.06 0a2.1 2.1 0 1 1-4.2 0V3a2.1 2.1 0 1 1 4.2 0v5.26Z" fill="#2EB67D" />
      <path d="M15.74 18.9a2.1 2.1 0 1 1-2.1 2.1v-2.1h2.1Zm0-1.06a2.1 2.1 0 0 1 0-4.2H21a2.1 2.1 0 1 1 0 4.2h-5.26Z" fill="#ECB22E" />
    </>
  ));

// ── FIGMA ──────────────────────────────────────────────────────────────────────
export const FigmaLogo: React.FC<LogoProps> = ({ size = 16, className, style }) =>
  wrap(size, "0 0 24 24", className, style, (
    <>
      <path d="M8.5 24a3.75 3.75 0 0 1-3.75-3.75A3.75 3.75 0 0 1 8.5 16.5h3.75v3.75A3.75 3.75 0 0 1 8.5 24Z" fill="#0ACF83" />
      <path d="M4.75 12A3.75 3.75 0 0 1 8.5 8.25h3.75v7.5H8.5A3.75 3.75 0 0 1 4.75 12Z" fill="#A259FF" />
      <path d="M4.75 3.75A3.75 3.75 0 0 1 8.5 0h3.75v7.5H8.5a3.75 3.75 0 0 1-3.75-3.75Z" fill="#F24E1E" />
      <path d="M12.25 0h3.75a3.75 3.75 0 1 1 0 7.5h-3.75V0Z" fill="#FF7262" />
      <path d="M19.75 12a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0Z" fill="#1ABCFE" />
    </>
  ));

// ── NOTION ─────────────────────────────────────────────────────────────────────
export const NotionLogo: React.FC<LogoProps> = ({ size = 16, className, style }) =>
  wrap(size, "0 0 24 24", className, style, (
    <>
      <rect x="1.5" y="1.5" width="21" height="21" rx="3" fill="#FFFFFF" stroke="#000000" strokeWidth="1.6" />
      <path
        d="M7 17V8.4l1.9-.2 5 6.7V8.6l-1.2-.2v-.6l3.5-.2v.6l-1 .2V17l-1.5.2-5.1-7v6.2l1.3.2v.6L7 17.4V17Z"
        fill="#000000"
      />
    </>
  ));

// ── CANVA ──────────────────────────────────────────────────────────────────────
export const CanvaLogo: React.FC<LogoProps> = ({ size = 16, className, style }) =>
  wrap(size, "0 0 24 24", className, style, (
    <>
      <defs>
        <linearGradient id="canva-grad" x1="2" y1="2" x2="22" y2="22" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#00C4CC" />
          <stop offset="100%" stopColor="#7D2AE8" />
        </linearGradient>
      </defs>
      <circle cx="12" cy="12" r="11" fill="url(#canva-grad)" />
      <path
        d="M15.2 14.6c-.9 1.4-2.3 2.3-3.8 2.3-2 0-3.3-1.5-3.3-3.7 0-3 2.1-5.7 4.5-5.7 1.2 0 2 .7 2 1.7 0 .9-.5 1.5-1.1 1.5-.4 0-.7-.3-.7-.7 0-.6.5-.8.5-1.3 0-.3-.3-.5-.7-.5-1.4 0-2.7 2.1-2.7 4.4 0 1.5.7 2.5 1.9 2.5 1 0 2-.6 2.8-1.8l.6.3Z"
        fill="#FFFFFF"
      />
    </>
  ));

// ── SHOPIFY ────────────────────────────────────────────────────────────────────
export const ShopifyLogo: React.FC<LogoProps> = ({ size = 16, className, style }) =>
  wrap(size, "0 0 24 24", className, style, (
    <>
      <path
        d="M15.5 3.4c-.1-.1-.3-.1-.4-.1l-.9.2s-.6-.6-.7-.7c-.1-.1-.2-.1-.4-.1l-.6 15.9 6.1 1.3S15.6 3.6 15.5 3.4Z"
        fill="#5A863E"
      />
      <path
        d="M13.9 3.5s-.5-.2-1.1-.2c-1.2 0-1.8.7-2.3 1.6-.5.9-.7 1.3-.7 1.3l-1.6.5c-.5.2-.5.2-.6.7C7.5 7.8 6 19.8 6 19.8l12.6 2.2L13.9 3.5Zm-1.5 2.4-1.9.6c.2-.7.6-1.4 1-1.8.2-.2.4-.3.7-.4.2.5.2 1.1.2 1.6Zm-.9-2.7c.2 0 .4.1.5.2-.4.2-.8.6-1.1 1-.4.6-.7 1.4-.8 2.2l-1.5.5c.4-1.4 1.5-3.8 2.9-3.9Zm1.2 8.2s-.7-.4-1.5-.4c-1.2 0-1.3.8-1.3 1 0 1.1 2.7 1.5 2.7 3.9 0 1.9-1.2 3.1-2.8 3.1-1.9 0-2.9-1.2-2.9-1.2l.5-1.7s1 .9 1.9.9c.6 0 .8-.4.8-.8 0-1.4-2.2-1.5-2.2-3.7 0-1.8 1.3-3.6 4-3.6 1 0 1.5.3 1.5.3l-.7 2.2Z"
        fill="#95BF47"
      />
    </>
  ));

// ── GOOGLE ANALYTICS ───────────────────────────────────────────────────────────
export const GoogleAnalyticsLogo: React.FC<LogoProps> = ({ size = 16, className, style }) =>
  wrap(size, "0 0 24 24", className, style, (
    <>
      <rect x="16.5" y="2" width="5.5" height="20" rx="2.75" fill="#F9AB00" />
      <rect x="9.25" y="8.5" width="5.5" height="13.5" rx="2.75" fill="#E37400" />
      <circle cx="4.75" cy="19.25" r="2.75" fill="#E37400" />
    </>
  ));

// ── GOOGLE CALENDAR ────────────────────────────────────────────────────────────
export const GoogleCalendarLogo: React.FC<LogoProps> = ({ size = 16, className, style }) =>
  wrap(size, "0 0 24 24", className, style, (
    <>
      <rect x="2" y="2" width="20" height="20" rx="3" fill="#4285F4" />
      <path d="M17 2h2a3 3 0 0 1 3 3v2h-5V2Z" fill="#1967D2" />
      <rect x="17" y="7" width="5" height="8" fill="#FBBC04" />
      <path d="M17 15h5v4a3 3 0 0 1-3 3h-2v-7Z" fill="#EA4335" />
      <rect x="2" y="15" width="15" height="7" fill="#34A853" />
      <rect x="2" y="15" width="5" height="7" fill="#188038" />
      <rect x="6" y="6" width="12" height="11" fill="#FFFFFF" />
      <path
        d="M10.05 14.4c-1.2 0-2.05-.68-2.2-1.72l1.06-.2c.1.62.55.98 1.14.98.6 0 1.05-.35 1.05-.87 0-.55-.44-.87-1.18-.87h-.5v-.94h.47c.65 0 1.05-.3 1.05-.8 0-.46-.36-.78-.9-.78-.53 0-.93.32-1.03.86l-1.03-.21c.17-1 .96-1.65 2.07-1.65 1.15 0 1.98.65 1.98 1.6 0 .6-.31 1.04-.83 1.28.63.22 1 .72 1 1.4 0 1.06-.9 1.82-2.15 1.82Zm4.02-.13V9.9l-1.15.8-.53-.84 1.86-1.3h.9v5.7h-1.08Z"
        fill="#4285F4"
      />
    </>
  ));

// ── GOOGLE DRIVE ───────────────────────────────────────────────────────────────
export const GoogleDriveLogo: React.FC<LogoProps> = ({ size = 16, className, style }) =>
  wrap(size, "0 0 24 24", className, style, (
    <>
      <path d="M8.55 2.5h6.9l6.9 12h-6.9l-6.9-12Z" fill="#FFC107" />
      <path d="M8.55 2.5 1.65 14.5l3.45 6 6.9-12-3.45-6Z" fill="#1976D2" />
      <path d="M5.1 20.5h13.8l3.45-6H8.55l-3.45 6Z" fill="#4CAF50" />
    </>
  ));

// ── GOOGLE (generic G) ─────────────────────────────────────────────────────────
export const GoogleLogo: React.FC<LogoProps> = ({ size = 16, className, style }) =>
  wrap(size, "0 0 24 24", className, style, (
    <>
      <path d="M23 12.27c0-.82-.07-1.6-.21-2.36H12v4.47h6.17a5.28 5.28 0 0 1-2.29 3.46v2.88h3.7C21.74 18.75 23 15.79 23 12.27Z" fill="#4285F4" />
      <path d="M12 23.5c3.1 0 5.7-1.03 7.58-2.78l-3.7-2.88c-1.03.69-2.34 1.1-3.88 1.1-2.98 0-5.5-2.01-6.41-4.72H1.77v2.97A11.5 11.5 0 0 0 12 23.5Z" fill="#34A853" />
      <path d="M5.59 14.22a6.9 6.9 0 0 1 0-4.43V6.82H1.77a11.5 11.5 0 0 0 0 10.37l3.82-2.97Z" fill="#FBBC05" />
      <path d="M12 5.07c1.68 0 3.19.58 4.38 1.72l3.28-3.28C17.7 1.63 15.1.5 12 .5A11.5 11.5 0 0 0 1.77 6.82l3.82 2.97C6.5 7.08 9.02 5.07 12 5.07Z" fill="#EA4335" />
    </>
  ));

// ── Resolver ───────────────────────────────────────────────────────────────────
const MATCHERS: Array<[RegExp, React.FC<LogoProps>]> = [
  [/google\s*drive|^gdrive$|^drive$/i, GoogleDriveLogo],
  [/google\s*calendar|^gcal$|^calendar$/i, GoogleCalendarLogo],
  [/google\s*analytics|^ganalytics$|^analytics$|ga4/i, GoogleAnalyticsLogo],
  [/shopify/i, ShopifyLogo],
  [/slack/i, SlackLogo],
  [/notion/i, NotionLogo],
  [/canva/i, CanvaLogo],
  [/figma/i, FigmaLogo],
  [/google|gmail/i, GoogleLogo],
];

export function getIntegrationLogo(name?: string | null): React.FC<LogoProps> | null {
  if (!name) return null;
  for (const [re, Comp] of MATCHERS) if (re.test(name)) return Comp;
  return null;
}

/** Renders the brand logo when known, otherwise `fallback`. */
export const IntegrationLogo: React.FC<LogoProps & { name?: string | null; fallback?: React.ReactNode }> = ({
  name,
  fallback = null,
  ...props
}) => {
  const Comp = getIntegrationLogo(name);
  if (!Comp) return <>{fallback}</>;
  return <Comp {...props} />;
};
