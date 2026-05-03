/**
 * One-time credit packs sold from the navbar "Add Credits" panel.
 * Sale prices are active until `saleEnd`. UI falls back to `price` after that.
 */
export interface CreditPack {
  id: string;
  credits: number;
  bonus: number;
  price: number;       // USD, original
  salePrice: number;   // USD, current sale
  saleEnd: string;     // ISO date
  popular?: boolean;
  badge?: string;
}

export const CREDIT_PACKS: CreditPack[] = [
  { id: "pack-300",   credits: 300,    bonus: 0,     price: 4.99,  salePrice: 3.99,  saleEnd: "2026-07-21" },
  { id: "pack-1000",  credits: 1_000,  bonus: 100,   price: 14.99, salePrice: 11.99, saleEnd: "2026-07-21", badge: "+100 bonus" },
  { id: "pack-2500",  credits: 2_500,  bonus: 300,   price: 24.99, salePrice: 19.99, saleEnd: "2026-07-21", popular: true, badge: "+300 bonus" },
  { id: "pack-12000", credits: 12_000, bonus: 1_000, price: 79.99, salePrice: 63.99, saleEnd: "2026-07-21", badge: "+1,000 bonus · best value" },
];

export const totalCredits = (p: CreditPack) => p.credits + p.bonus;

/** Imperative trigger — any button can open the global payment window. */
export type PaymentIntent =
  | { kind: "pack"; pack: CreditPack }
  | { kind: "plan"; tierId: "explorer" | "operator" | "titan" | "enterprise"; annual?: boolean; price: number; name: string };

export const openPaymentWindow = (intent: PaymentIntent) => {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("nazai:open-payment", { detail: intent }));
};
