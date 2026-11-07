// The one small creative each onboarding and limit window carries (docs/onboarding-windows.md, "Creative system").
//
// One visual language for all of them: a 72×72 dark tile, thin cyan strokes (#22d3ee and its lighter tint #67e8f9 only), round
// line caps, one soft glow, no photos and no lock imagery. Abstract and product-related: steps, nodes, a rule layer, a shield.

export type OnboardingArtKind = "first-step" | "linked-nodes" | "shield-check" | "soft-progress" | "feedback-check";

const CYAN = "#22d3ee";
const TINT = "#67e8f9";

const LABELS: Record<OnboardingArtKind, string> = {
  "first-step": "A first step passing one control point",
  "linked-nodes": "Connected tools under one rule layer",
  "shield-check": "A shield with a check mark",
  "soft-progress": "A full allowance ring around saved work",
  "feedback-check": "A check mark with two optional reactions",
};

function Art({ kind }: { kind: OnboardingArtKind }) {
  switch (kind) {
    case "first-step":
      // A start point, one controlled step (the gate), and the path that follows, still faint.
      return (
        <>
          <circle cx="14" cy="36" r="3.5" fill={TINT} />
          <line x1="18" y1="36" x2="30" y2="36" stroke={CYAN} strokeWidth="2" strokeLinecap="round" />
          <rect x="30" y="26" width="16" height="20" rx="5" fill={CYAN} fillOpacity="0.12" stroke={CYAN} strokeWidth="1.6" />
          <path d="M34.5 36.5 l2.6 2.6 l4.6 -5" fill="none" stroke={TINT} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          <line x1="46" y1="36" x2="60" y2="36" stroke={CYAN} strokeOpacity="0.35" strokeWidth="2" strokeLinecap="round" strokeDasharray="2 4" />
        </>
      );
    case "linked-nodes":
      // Three tools linked to each other, all sitting under one rule layer.
      return (
        <>
          <rect x="12" y="13" width="48" height="7" rx="3.5" fill={CYAN} fillOpacity="0.14" stroke={CYAN} strokeWidth="1.4" />
          {[22, 36, 50].map((x) => <line key={x} x1={x} y1="20" x2={x} y2="28" stroke={CYAN} strokeOpacity="0.45" strokeWidth="1.2" strokeDasharray="1.5 2" />)}
          <path d="M22 44 L36 34 L50 44 Z" fill="none" stroke={CYAN} strokeOpacity="0.55" strokeWidth="1.4" strokeLinejoin="round" />
          <circle cx="36" cy="34" r="4.5" fill="#04101f" stroke={TINT} strokeWidth="1.8" />
          <circle cx="22" cy="46" r="4.5" fill="#04101f" stroke={CYAN} strokeWidth="1.8" />
          <circle cx="50" cy="46" r="4.5" fill="#04101f" stroke={CYAN} strokeWidth="1.8" />
          <line x1="26.5" y1="46" x2="45.5" y2="46" stroke={CYAN} strokeOpacity="0.55" strokeWidth="1.4" />
        </>
      );
    case "shield-check":
      return (
        <>
          <path d="M36 14 l17 6.5 v12 c0 11 -7.5 18.5 -17 22 c-9.5 -3.5 -17 -11 -17 -22 v-12 z" fill={CYAN} fillOpacity="0.12" stroke={CYAN} strokeWidth="1.8" strokeLinejoin="round" />
          <path d="M28.5 35 l5.2 5.2 l9.8 -10.4" fill="none" stroke={TINT} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
        </>
      );
    case "soft-progress": {
      // A ring of three soft segments, all filled (this month's allowance is used), around two saved items (still available).
      const r = 22, c = 2 * Math.PI * r, seg = c / 3, gap = 5;
      return (
        <>
          <circle cx="36" cy="36" r={r} fill="none" stroke={CYAN} strokeOpacity="0.12" strokeWidth="4" />
          {[0, 1, 2].map((i) => (
            <circle key={i} cx="36" cy="36" r={r} fill="none" stroke={CYAN} strokeOpacity={0.55 + i * 0.15} strokeWidth="4" strokeLinecap="round"
              strokeDasharray={`${seg - gap} ${c - seg + gap}`} strokeDashoffset={-i * seg} transform="rotate(-90 36 36)" />
          ))}
          <rect x="27" y="27" width="16" height="12" rx="2.5" fill="#04101f" stroke={CYAN} strokeOpacity="0.5" strokeWidth="1.3" />
          <rect x="29" y="31" width="16" height="12" rx="2.5" fill="#04101f" stroke={TINT} strokeWidth="1.5" />
          <line x1="32" y1="35.5" x2="42" y2="35.5" stroke={TINT} strokeOpacity="0.7" strokeWidth="1.3" strokeLinecap="round" />
          <line x1="32" y1="39" x2="38.5" y2="39" stroke={TINT} strokeOpacity="0.45" strokeWidth="1.3" strokeLinecap="round" />
        </>
      );
    }
    case "feedback-check":
      // One clean check, and two small optional reaction marks beside it.
      return (
        <>
          <circle cx="30" cy="34" r="14" fill={CYAN} fillOpacity="0.12" stroke={CYAN} strokeWidth="1.8" />
          <path d="M23.5 34 l4.4 4.4 l8.6 -9" fill="none" stroke={TINT} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="54" cy="25" r="5" fill="none" stroke={CYAN} strokeOpacity="0.55" strokeWidth="1.4" />
          <path d="M51.8 25.6 q2.2 2 4.4 0" fill="none" stroke={CYAN} strokeOpacity="0.7" strokeWidth="1.2" strokeLinecap="round" />
          <circle cx="54" cy="43" r="5" fill="none" stroke={CYAN} strokeOpacity="0.35" strokeWidth="1.4" />
          <line x1="51.8" y1="43.5" x2="56.2" y2="43.5" stroke={CYAN} strokeOpacity="0.5" strokeWidth="1.2" strokeLinecap="round" />
        </>
      );
  }
}

export default function OnboardingArt({ kind, size = 72, className = "" }: { kind: OnboardingArtKind; size?: number; className?: string }) {
  const glow = `oa-glow-${kind}`;
  return (
    <svg width={size} height={size} viewBox="0 0 72 72" role="img" aria-label={LABELS[kind]} className={`shrink-0 ${className}`} data-testid={`onboarding-art-${kind}`}>
      <defs>
        <radialGradient id={glow} cx="50%" cy="45%" r="60%">
          <stop offset="0%" stopColor={CYAN} stopOpacity="0.16" />
          <stop offset="100%" stopColor={CYAN} stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect x="0.5" y="0.5" width="71" height="71" rx="18" fill="#030a17" stroke={CYAN} strokeOpacity="0.22" />
      <rect x="0.5" y="0.5" width="71" height="71" rx="18" fill={`url(#${glow})`} />
      <Art kind={kind} />
    </svg>
  );
}
