/**
 * Credit tier definitions — single source of truth for both the Pricing page
 * and the in-app CreditBalance widget. `monthlyCredits` powers the
 * "X / Y credits" display in the navbar.
 */
export type TierId = "explorer" | "operator" | "titan" | "enterprise";

export interface TierPlan {
  id: TierId;
  name: string;
  monthlyCredits: number; // null-equivalent handled as "Custom" below
  monthlyPrice: number; // USD
  annualPrice: number;  // USD per month, billed annually
  overageRate: string;  // human-readable
  isCustom?: boolean;
}

export const TIER_PLANS: Record<TierId, TierPlan> = {
  explorer: {
    id: "explorer",
    name: "Explorer",
    monthlyCredits: 300,
    monthlyPrice: 0,
    annualPrice: 0,
    overageRate: "No overage — upgrade to continue",
  },
  operator: {
    id: "operator",
    name: "Operator",
    monthlyCredits: 2_500,
    monthlyPrice: 34,
    annualPrice: 25,
    overageRate: "$0.018 per extra credit",
  },
  titan: {
    id: "titan",
    name: "Titan",
    monthlyCredits: 12_000,
    monthlyPrice: 119,
    annualPrice: 89,
    overageRate: "$0.012 per extra credit",
  },
  enterprise: {
    id: "enterprise",
    name: "Enterprise",
    monthlyCredits: 0, // displayed as "Custom"
    monthlyPrice: 0,
    annualPrice: 0,
    overageRate: "Custom — negotiated SLA",
    isCustom: true,
  },
};

export const TIER_ORDER: TierId[] = ["explorer", "operator", "titan", "enterprise"];

const STORAGE_KEY = "nazai:user-tier";

export const getStoredTier = (): TierId => {
  if (typeof window === "undefined") return "explorer";
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw && (TIER_ORDER as string[]).includes(raw)) return raw as TierId;
  } catch {
    /* noop */
  }
  return "explorer";
};

export const setStoredTier = (tier: TierId) => {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, tier);
    window.dispatchEvent(new CustomEvent("nazai:tier-changed", { detail: tier }));
  } catch {
    /* noop */
  }
};

/** Format a credit number with locale separators (e.g. 12000 → "12,000"). */
export const formatCredits = (n: number): string => n.toLocaleString("en-US");
