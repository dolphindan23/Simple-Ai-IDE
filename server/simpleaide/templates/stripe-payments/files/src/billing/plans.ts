export interface Plan {
  id: string;
  name: string;
  description: string;
  priceId: string;
  price: number;
  currency: string;
  interval: "month" | "year";
  features: string[];
}

export const PLANS: Plan[] = [
  {
    id: "free",
    name: "Free",
    description: "Get started with basic features",
    priceId: "", 
    price: 0,
    currency: "usd",
    interval: "month",
    features: [
      "Basic features",
      "Community support",
      "5 projects",
    ],
  },
  {
    id: "pro",
    name: "Pro",
    description: "For professionals and growing teams",
    priceId: "price_REPLACE_WITH_STRIPE_PRICE_ID",
    price: 29,
    currency: "usd",
    interval: "month",
    features: [
      "All Free features",
      "Unlimited projects",
      "Priority support",
      "Advanced analytics",
      "Team collaboration",
    ],
  },
  {
    id: "enterprise",
    name: "Enterprise",
    description: "For large organizations",
    priceId: "price_REPLACE_WITH_STRIPE_PRICE_ID",
    price: 99,
    currency: "usd",
    interval: "month",
    features: [
      "All Pro features",
      "Custom integrations",
      "Dedicated support",
      "SLA guarantee",
      "SSO authentication",
    ],
  },
];

export function getPlanById(planId: string): Plan | undefined {
  return PLANS.find((plan) => plan.id === planId);
}

export function getPlanByPriceId(priceId: string): Plan | undefined {
  return PLANS.find((plan) => plan.priceId === priceId);
}
