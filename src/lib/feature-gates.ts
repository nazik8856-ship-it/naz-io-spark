/**
 * Feature gating — single source of truth for which capabilities each
 * subscription tier unlocks. Maps the marketing copy on Pricing.tsx into
 * runtime flags consumed by Dashboard.tsx and related components.
 *
 * Tier rules (decided with product):
 *   • Explorer  → light/dark themes only, no specialized AI modes,
 *                 max 2 concurrent agents, no Brand-Snap, no Aura Studio.
 *   • Operator  → all visual themes, both AI modes, 8 concurrent agents,
 *                 Aura Studio. Brand-Snap still gated.
 *   • Titan     → everything, 30 concurrent agents.
 *   • Enterprise → same as Titan + custom; treated as superset.
 */
import { useEffect, useState } from "react";
import { getStoredTier, TierId } from "./credit-tiers";

export type FeatureKey =
  | "mode.pro-designer"
  | "mode.antifragile"
  | "themes.visual"        // The full 6-theme NazAI visual gallery
  | "themes.lightDarkOnly" // Explorer-only marker
  | "aura-studio"
  | "brand-snap"
  | "agents.cap";          // Numeric cap surfaced via maxConcurrentAgents()

interface TierCapabilities {
  modes: { proDesigner: boolean; antifragile: boolean };
  visualThemes: boolean;       // full NazAI theme gallery
  auraStudio: boolean;
  brandSnap: boolean;
  maxAgents: number;
}

export const TIER_CAPABILITIES: Record<TierId, TierCapabilities> = {
  explorer: {
    modes: { proDesigner: false, antifragile: false },
    visualThemes: false,
    auraStudio: false,
    brandSnap: false,
    maxAgents: 2,
  },
  operator: {
    modes: { proDesigner: true, antifragile: true },
    visualThemes: true,
    auraStudio: true,
    brandSnap: false,
    maxAgents: 8,
  },
  titan: {
    modes: { proDesigner: true, antifragile: true },
    visualThemes: true,
    auraStudio: true,
    brandSnap: true,
    maxAgents: 30,
  },
  enterprise: {
    modes: { proDesigner: true, antifragile: true },
    visualThemes: true,
    auraStudio: true,
    brandSnap: true,
    maxAgents: 999,
  },
};

export const hasFeature = (tier: TierId, key: FeatureKey): boolean => {
  const caps = TIER_CAPABILITIES[tier];
  switch (key) {
    case "mode.pro-designer": return caps.modes.proDesigner;
    case "mode.antifragile":  return caps.modes.antifragile;
    case "themes.visual":     return caps.visualThemes;
    case "themes.lightDarkOnly": return !caps.visualThemes;
    case "aura-studio":       return caps.auraStudio;
    case "brand-snap":        return caps.brandSnap;
    case "agents.cap":        return true;
  }
};

export const maxConcurrentAgents = (tier: TierId): number =>
  TIER_CAPABILITIES[tier].maxAgents;

/** Reactive hook — re-renders when the user changes plan in-app. */
export const useTier = (): TierId => {
  const [tier, setTier] = useState<TierId>(() => getStoredTier());
  useEffect(() => {
    const onChange = (e: Event) => {
      const next = (e as CustomEvent).detail as TierId | undefined;
      if (next) setTier(next);
    };
    window.addEventListener("nazai:tier-changed", onChange);
    return () => window.removeEventListener("nazai:tier-changed", onChange);
  }, []);
  return tier;
};

/** Convenience: returns hasFeature bound to the current user tier. */
export const useFeature = (key: FeatureKey): boolean => {
  const tier = useTier();
  return hasFeature(tier, key);
};
